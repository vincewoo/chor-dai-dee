#!/usr/bin/env python3
"""CUDA PPO optimizer for canonical variable-action JavaScript trajectories."""

import argparse
import copy
import json
import math
import os
import time

import numpy as np
import torch
from torch import nn


DECISION_DTYPE = np.dtype([
    ("action_count", "<u2"),
    ("chosen_index", "<u2"),
    ("heuristic_index", "<u2"),
    ("flags", "<u2"),
    ("old_log_probability", "<f4"),
    ("old_value", "<f4"),
    ("advantage", "<f4"),
    ("return", "<f4"),
])


class ActorCritic(nn.Module):
    def __init__(self, action_size, state_indices, actor_hidden, critic_hidden):
        super().__init__()
        self.register_buffer(
            "state_indices", torch.tensor(state_indices, dtype=torch.long)
        )
        self.actor1 = nn.Linear(action_size, actor_hidden)
        self.actor2 = nn.Linear(actor_hidden, 1)
        self.critic1 = nn.Linear(len(state_indices), critic_hidden)
        self.critic2 = nn.Linear(critic_hidden, 1)

    def actor(self, features):
        return self.actor2(torch.tanh(self.actor1(features))).squeeze(-1)

    def critic(self, candidate_features):
        states = candidate_features.index_select(1, self.state_indices)
        return torch.tanh(
            self.critic2(torch.tanh(self.critic1(states)))
        ).squeeze(-1)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--experience", required=True)
    parser.add_argument("--resume", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=2048)
    parser.add_argument("--learning-rate", type=float, default=3e-5)
    parser.add_argument("--clip-ratio", type=float, default=0.2)
    parser.add_argument("--value-coef", type=float, default=0.5)
    parser.add_argument("--entropy-coef", type=float, default=0.01)
    parser.add_argument("--imitation-coef", type=float, default=0.005)
    parser.add_argument("--target-kl", type=float, default=0.02)
    parser.add_argument("--seed", type=int, default=551)
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


def load_data(prefix):
    with open(f"{prefix}.json", "r", encoding="utf-8") as handle:
        metadata = json.load(handle)
    if metadata.get("kind") != "chor-dai-dee-ppo-experience":
        raise ValueError("experience is not a PPO trajectory buffer")
    width = len(metadata["featureNames"])
    actions = np.memmap(
        f"{prefix}.actions.bin", dtype="<f4", mode="r"
    )
    expected_actions = metadata["actionRows"] * width
    if actions.size != expected_actions:
        raise ValueError(
            f"action file has {actions.size} floats, expected {expected_actions}"
        )
    actions = actions.reshape(metadata["actionRows"], width)
    decisions = np.memmap(
        f"{prefix}.decisions.bin", dtype=DECISION_DTYPE, mode="r"
    )
    if len(decisions) != metadata["decisions"]:
        raise ValueError("decision file size does not match its sidecar")
    counts = decisions["action_count"].astype(np.int64)
    offsets = np.empty(len(counts) + 1, dtype=np.int64)
    offsets[0] = 0
    np.cumsum(counts, out=offsets[1:])
    if offsets[-1] != metadata["actionRows"]:
        raise ValueError("decision action counts do not cover the action file")
    return metadata, actions, decisions, offsets


def load_model(artifact_path, feature_names):
    with open(artifact_path, "r", encoding="utf-8") as handle:
        artifact = json.load(handle)
    if artifact.get("kind") != "chor-dai-dee-ppo-policy":
        raise ValueError("resume artifact is not a PPO policy")
    if artifact.get("featureNames") != feature_names:
        raise ValueError("PPO feature schema mismatch")
    state_names = artifact["stateFeatureNames"]
    state_indices = [feature_names.index(name) for name in state_names]
    model = ActorCritic(
        len(feature_names),
        state_indices,
        artifact["actorHiddenSize"],
        artifact["criticHiddenSize"],
    )
    p = artifact["parameters"]
    with torch.no_grad():
        model.actor1.weight.copy_(torch.tensor(p["actorW1"]))
        model.actor1.bias.copy_(torch.tensor(p["actorB1"]))
        model.actor2.weight.copy_(
            torch.tensor(p["actorW2"]).unsqueeze(0)
        )
        model.actor2.bias.copy_(torch.tensor([p["actorB2"]]))
        model.critic1.weight.copy_(torch.tensor(p["criticW1"]))
        model.critic1.bias.copy_(torch.tensor(p["criticB1"]))
        model.critic2.weight.copy_(
            torch.tensor(p["criticW2"]).unsqueeze(0)
        )
        model.critic2.bias.copy_(torch.tensor([p["criticB2"]]))
    return artifact, model


def batch_tensors(actions, decisions, offsets, decision_indices, device):
    counts_np = decisions["action_count"][decision_indices].astype(np.int64)
    action_indices = np.concatenate([
        np.arange(offsets[index], offsets[index + 1], dtype=np.int64)
        for index in decision_indices
    ])
    features = torch.from_numpy(
        np.asarray(actions[action_indices]).copy()
    ).to(device)
    counts = torch.from_numpy(counts_np).to(device)
    segments = torch.repeat_interleave(
        torch.arange(len(decision_indices), device=device), counts
    )
    starts = torch.cumsum(counts, dim=0) - counts
    chosen = torch.from_numpy(
        decisions["chosen_index"][decision_indices].astype(np.int64)
    ).to(device)
    heuristic = torch.from_numpy(
        decisions["heuristic_index"][decision_indices].astype(np.int64)
    ).to(device)
    chosen_flat = starts + chosen
    heuristic_flat = starts + heuristic
    return {
        "features": features,
        "segments": segments,
        "counts": counts,
        "chosen_flat": chosen_flat,
        "heuristic_flat": heuristic_flat,
        "old_log_probability": torch.from_numpy(
            decisions["old_log_probability"][decision_indices].copy()
        ).to(device),
        "old_value": torch.from_numpy(
            decisions["old_value"][decision_indices].copy()
        ).to(device),
        "advantage": torch.from_numpy(
            decisions["advantage"][decision_indices].copy()
        ).to(device),
        "return": torch.from_numpy(
            decisions["return"][decision_indices].copy()
        ).to(device),
    }


def grouped_log_probabilities(logits, segments, group_count):
    maxima = torch.full(
        (group_count,), -torch.inf, device=logits.device
    )
    maxima.scatter_reduce_(
        0, segments, logits, reduce="amax", include_self=True
    )
    shifted = logits - maxima[segments]
    sums = torch.zeros(group_count, device=logits.device)
    sums.scatter_add_(0, segments, shifted.exp())
    log_normalizer = maxima + sums.log()
    return logits - log_normalizer[segments]


def export_artifact(model, source, metadata, args, selected_epoch, metrics):
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
            "algorithm": "PPO-GAE",
            "epochsRequested": args.epochs,
            "selectedEpoch": selected_epoch,
            "batchSize": args.batch_size,
            "learningRate": args.learning_rate,
            "clipRatio": args.clip_ratio,
            "valueCoefficient": args.value_coef,
            "entropyCoefficient": args.entropy_coef,
            "imitationCoefficient": args.imitation_coef,
            "targetKl": args.target_kl,
            "seed": args.seed,
            "experienceRounds": metadata["rounds"],
            "experienceDecisions": metadata["decisions"],
            "experienceActionRows": metadata["actionRows"],
            "experiencePolicy": metadata["policy"],
            "gamma": metadata["gamma"],
            "gaeLambda": metadata["gaeLambda"],
            "resumedFrom": os.path.basename(args.resume),
            **metrics,
        },
    }


def main():
    args = parse_args()
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    device = select_device(args.device)
    metadata, actions, decisions, offsets = load_data(args.experience)
    source, model = load_model(args.resume, metadata["featureNames"])
    model = model.to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.learning_rate, weight_decay=1e-5
    )

    advantages = decisions["advantage"]
    advantage_mean = float(np.mean(advantages))
    advantage_std = float(np.std(advantages) + 1e-8)
    order_rng = np.random.default_rng(args.seed)
    safe_state = copy.deepcopy(model.state_dict())
    selected_epoch = 0
    selected_metrics = {}

    print(
        f"device={device} decisions={len(decisions)} "
        f"actions={metadata['actionRows']} torch={torch.__version__}"
    )
    if device.type == "cuda":
        print(f"gpu={torch.cuda.get_device_name(0)}")

    for epoch in range(1, args.epochs + 1):
        started = time.perf_counter()
        totals = {
            "policy": 0.0,
            "value": 0.0,
            "entropy": 0.0,
            "imitation": 0.0,
            "kl": 0.0,
            "clip": 0.0,
            "examples": 0,
        }
        permutation = order_rng.permutation(len(decisions))
        model.train()
        for start in range(0, len(decisions), args.batch_size):
            indices = permutation[start:start + args.batch_size]
            batch = batch_tensors(
                actions, decisions, offsets, indices, device
            )
            logits = (
                model.actor(batch["features"]) / metadata["temperature"]
            )
            log_probabilities = grouped_log_probabilities(
                logits, batch["segments"], len(indices)
            )
            chosen_log_probability = log_probabilities[
                batch["chosen_flat"]
            ]
            normalized_advantage = (
                batch["advantage"] - advantage_mean
            ) / advantage_std
            ratio = (
                chosen_log_probability - batch["old_log_probability"]
            ).exp()
            unclipped = ratio * normalized_advantage
            clipped = torch.clamp(
                ratio, 1 - args.clip_ratio, 1 + args.clip_ratio
            ) * normalized_advantage
            policy_loss = -torch.minimum(unclipped, clipped).mean()

            first_actions = batch["features"][
                torch.cumsum(batch["counts"], dim=0) - batch["counts"]
            ]
            values = model.critic(first_actions)
            value_loss = torch.mean((values - batch["return"]) ** 2)

            probabilities = log_probabilities.exp()
            entropy_per_decision = torch.zeros(
                len(indices), device=device
            )
            entropy_per_decision.scatter_add_(
                0,
                batch["segments"],
                -(probabilities * log_probabilities),
            )
            entropy = entropy_per_decision.mean()
            imitation_loss = -log_probabilities[
                batch["heuristic_flat"]
            ].mean()
            loss = (
                policy_loss
                + args.value_coef * value_loss
                - args.entropy_coef * entropy
                + args.imitation_coef * imitation_loss
            )
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            optimizer.step()

            with torch.no_grad():
                log_ratio = (
                    chosen_log_probability
                    - batch["old_log_probability"]
                )
                approximate_kl = (
                    (ratio - 1) - log_ratio
                ).mean()
                clip_fraction = (
                    (torch.abs(ratio - 1) > args.clip_ratio)
                    .float()
                    .mean()
                )
            size = len(indices)
            totals["policy"] += float(policy_loss.item()) * size
            totals["value"] += float(value_loss.item()) * size
            totals["entropy"] += float(entropy.item()) * size
            totals["imitation"] += float(imitation_loss.item()) * size
            totals["kl"] += float(approximate_kl.item()) * size
            totals["clip"] += float(clip_fraction.item()) * size
            totals["examples"] += size

        examples = totals["examples"]
        metrics = {
            "policyLoss": totals["policy"] / examples,
            "valueLoss": totals["value"] / examples,
            "entropy": totals["entropy"] / examples,
            "imitationLoss": totals["imitation"] / examples,
            "approximateKl": totals["kl"] / examples,
            "clipFraction": totals["clip"] / examples,
        }
        print(
            f"epoch={epoch:03d} policy={metrics['policyLoss']:.6f} "
            f"value={metrics['valueLoss']:.6f} "
            f"entropy={metrics['entropy']:.4f} "
            f"kl={metrics['approximateKl']:.5f} "
            f"clip={metrics['clipFraction']:.3f} "
            f"seconds={time.perf_counter() - started:.2f}",
            flush=True,
        )
        if (
            metrics["approximateKl"] > args.target_kl * 1.5
            and selected_epoch > 0
        ):
            model.load_state_dict(safe_state)
            print(
                f"early-stop epoch={epoch:03d} "
                f"kl={metrics['approximateKl']:.5f}"
            )
            break
        safe_state = copy.deepcopy(model.state_dict())
        selected_epoch = epoch
        selected_metrics = metrics

    artifact = export_artifact(
        model,
        source,
        metadata,
        args,
        selected_epoch,
        selected_metrics,
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
