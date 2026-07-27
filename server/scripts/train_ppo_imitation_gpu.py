#!/usr/bin/env python3
"""Distill an RL value policy's decisions into the deployable PPO actor."""

import argparse
import copy
import json
import os
import time

import numpy as np
import torch
from torch import nn

from train_ppo_gpu import (
    batch_tensors,
    grouped_log_probabilities,
    load_data,
    load_model,
)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--experience", required=True)
    parser.add_argument("--resume", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=2048)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--override-weight", type=float, default=12)
    parser.add_argument("--entropy-coef", type=float, default=0.001)
    parser.add_argument("--validation-fraction", type=float, default=0.05)
    parser.add_argument("--seed", type=int, default=7331)
    parser.add_argument(
        "--device", choices=("auto", "cuda", "cpu"), default="auto"
    )
    return parser.parse_args()


def select_device(requested):
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was required but is unavailable")
    if requested == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(requested)


def imitation_batch(
    model,
    actions,
    decisions,
    offsets,
    indices,
    device,
    override_weight,
):
    batch = batch_tensors(actions, decisions, offsets, indices, device)
    logits = model.actor(batch["features"])
    log_probabilities = grouped_log_probabilities(
        logits, batch["segments"], len(indices)
    )
    teacher_log_probability = log_probabilities[batch["chosen_flat"]]
    teacher_indices = torch.from_numpy(
        decisions["chosen_index"][indices].astype(np.int64)
    ).to(device)
    heuristic_indices = torch.from_numpy(
        decisions["heuristic_index"][indices].astype(np.int64)
    ).to(device)
    weights = torch.where(
        teacher_indices != heuristic_indices,
        torch.full_like(teacher_log_probability, override_weight),
        torch.ones_like(teacher_log_probability),
    )
    loss = -(weights * teacher_log_probability).sum() / weights.sum()
    probabilities = log_probabilities.exp()
    entropy_per_decision = torch.zeros(len(indices), device=device)
    entropy_per_decision.scatter_add_(
        0,
        batch["segments"],
        -(probabilities * log_probabilities),
    )
    maxima = torch.full(
        (len(indices),), -torch.inf, device=device
    )
    maxima.scatter_reduce_(
        0, batch["segments"], logits, reduce="amax", include_self=True
    )
    agreement = logits[batch["chosen_flat"]] >= maxima - 1e-7
    overrides = teacher_indices != heuristic_indices
    return {
        "loss": loss,
        "entropy": entropy_per_decision.mean(),
        "agreement": agreement,
        "overrides": overrides,
    }


def evaluate(
    model,
    actions,
    decisions,
    offsets,
    indices,
    device,
    batch_size,
    override_weight,
):
    totals = {
        "loss": 0.0,
        "examples": 0,
        "agreement": 0,
        "override_examples": 0,
        "override_agreement": 0,
    }
    model.eval()
    with torch.no_grad():
        for start in range(0, len(indices), batch_size):
            chosen = indices[start:start + batch_size]
            result = imitation_batch(
                model,
                actions,
                decisions,
                offsets,
                chosen,
                device,
                override_weight,
            )
            size = len(chosen)
            totals["loss"] += float(result["loss"].item()) * size
            totals["examples"] += size
            totals["agreement"] += int(result["agreement"].sum().item())
            totals["override_examples"] += int(
                result["overrides"].sum().item()
            )
            totals["override_agreement"] += int(
                (result["agreement"] & result["overrides"]).sum().item()
            )
    return {
        "loss": totals["loss"] / max(1, totals["examples"]),
        "agreement": totals["agreement"] / max(1, totals["examples"]),
        "overrideAgreement": totals["override_agreement"] /
        max(1, totals["override_examples"]),
        "overrideExamples": totals["override_examples"],
    }


def export_artifact(model, source, metadata, args, epoch, validation):
    def values(tensor):
        return tensor.detach().cpu().tolist()

    return {
        "schemaVersion": 1,
        "kind": "chor-dai-dee-ppo-policy",
        "featureNames": source["featureNames"],
        "stateFeatureNames": source["stateFeatureNames"],
        "actorHiddenSize": source["actorHiddenSize"],
        "criticHiddenSize": source["criticHiddenSize"],
        "parameters": {
            "actorW1": values(model.actor1.weight),
            "actorB1": values(model.actor1.bias),
            "actorW2": values(model.actor2.weight.squeeze(0)),
            "actorB2": float(model.actor2.bias.item()),
            "criticW1": values(model.critic1.weight),
            "criticB1": values(model.critic1.bias),
            "criticW2": values(model.critic2.weight.squeeze(0)),
            "criticB2": float(model.critic2.bias.item()),
        },
        "metadata": {
            "trainedAt": time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
            ),
            "algorithm": "behavior-cloning",
            "teacher": metadata["teacher"],
            "teacherHeuristicWeight": metadata["teacherHeuristicWeight"],
            "teacherOverrideMargin": metadata["teacherOverrideMargin"],
            "epochsRequested": args.epochs,
            "selectedEpoch": epoch,
            "batchSize": args.batch_size,
            "learningRate": args.learning_rate,
            "overrideWeight": args.override_weight,
            "entropyCoefficient": args.entropy_coef,
            "experienceRounds": metadata["rounds"],
            "experienceDecisions": metadata["decisions"],
            "experienceActionRows": metadata["actionRows"],
            "teacherOverrides": metadata["teacherOverrides"],
            "validation": validation,
            "resumedFrom": os.path.basename(args.resume),
        },
    }


def main():
    args = parse_args()
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    device = select_device(args.device)
    metadata, actions, decisions, offsets = load_data(
        args.experience,
        expected_kinds=("chor-dai-dee-ppo-imitation-experience",),
    )
    source, model = load_model(args.resume, metadata["featureNames"])
    model = model.to(device)
    for parameter in list(model.critic1.parameters()) + \
            list(model.critic2.parameters()):
        parameter.requires_grad_(False)
    optimizer = torch.optim.AdamW(
        [parameter for parameter in model.parameters()
         if parameter.requires_grad],
        lr=args.learning_rate,
        weight_decay=1e-5,
    )

    rng = np.random.default_rng(args.seed)
    permutation = rng.permutation(len(decisions))
    validation_count = max(
        1, int(len(permutation) * args.validation_fraction)
    )
    validation_indices = permutation[:validation_count]
    training_indices = permutation[validation_count:]
    print(
        f"device={device} decisions={len(decisions)} "
        f"actions={metadata['actionRows']} "
        f"teacher_overrides={metadata['teacherOverrides']} "
        f"torch={torch.__version__}"
    )
    if device.type == "cuda":
        print(f"gpu={torch.cuda.get_device_name(0)}")

    best_state = copy.deepcopy(model.state_dict())
    best_validation = None
    best_epoch = 0
    for epoch in range(1, args.epochs + 1):
        started = time.perf_counter()
        order = rng.permutation(training_indices)
        model.train()
        total_loss = 0.0
        total_examples = 0
        for start in range(0, len(order), args.batch_size):
            indices = order[start:start + args.batch_size]
            result = imitation_batch(
                model,
                actions,
                decisions,
                offsets,
                indices,
                device,
                args.override_weight,
            )
            loss = result["loss"] - args.entropy_coef * result["entropy"]
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1)
            optimizer.step()
            total_loss += float(result["loss"].item()) * len(indices)
            total_examples += len(indices)

        validation = evaluate(
            model,
            actions,
            decisions,
            offsets,
            validation_indices,
            device,
            args.batch_size,
            args.override_weight,
        )
        print(
            f"epoch={epoch:03d} "
            f"train={total_loss / total_examples:.5f} "
            f"validation={validation['loss']:.5f} "
            f"agreement={validation['agreement'] * 100:.2f}% "
            f"override_agreement="
            f"{validation['overrideAgreement'] * 100:.2f}% "
            f"seconds={time.perf_counter() - started:.2f}",
            flush=True,
        )
        score = (
            validation["overrideAgreement"],
            validation["agreement"],
            -validation["loss"],
        )
        best_score = None if best_validation is None else (
            best_validation["overrideAgreement"],
            best_validation["agreement"],
            -best_validation["loss"],
        )
        if best_score is None or score > best_score:
            best_state = copy.deepcopy(model.state_dict())
            best_validation = validation
            best_epoch = epoch

    model.load_state_dict(best_state)
    artifact = export_artifact(
        model, source, metadata, args, best_epoch, best_validation
    )
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    temporary = f"{args.output}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(artifact, handle, separators=(",", ":"))
        handle.write("\n")
    os.replace(temporary, args.output)
    print(f"checkpoint={args.output}")


if __name__ == "__main__":
    main()
