#!/usr/bin/env python3
"""Batched CPU/GPU optimizer for canonical JavaScript experience buffers."""

import argparse
import json
import os
import random
import time

import numpy as np
import torch
from torch import nn


class CandidateValueNetwork(nn.Module):
    def __init__(self, input_size: int, hidden_size: int):
        super().__init__()
        # This shape intentionally matches RLValueModel.js for direct export.
        self.fc1 = nn.Linear(input_size, hidden_size)
        self.out = nn.Linear(hidden_size, 1)

    def forward(self, features):
        hidden = torch.tanh(self.fc1(features))
        return torch.tanh(self.out(hidden)).squeeze(-1)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--experience",
        required=True,
        action="append",
        help="replay buffer; repeat to train on multiple buffers",
    )
    parser.add_argument("--output", required=True)
    parser.add_argument("--resume")
    parser.add_argument("--hidden", type=int, default=256)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=8192)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--validation-fraction", type=float, default=0.10)
    parser.add_argument("--seed", type=int, default=228)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    return parser.parse_args()


def select_device(requested: str):
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was required but torch.cuda.is_available() is false")
    if requested == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(requested)


def load_experience(path: str):
    with open(f"{path}.json", "r", encoding="utf-8") as handle:
        metadata = json.load(handle)
    columns = metadata["columns"]
    width = len(columns)
    raw = np.memmap(path, dtype="<f4", mode="r")
    expected = metadata["rows"] * width
    if raw.size != expected:
        raise ValueError(
            f"experience size mismatch: sidecar describes {expected} floats, found {raw.size}"
        )
    rows = np.asarray(raw.reshape(metadata["rows"], width))
    # Copy once into ordinary arrays. torch.from_numpy cannot safely train from
    # a read-only memmap and random batches would make disk access pathological.
    features = torch.from_numpy(rows[:, :-1].copy())
    targets = torch.from_numpy(rows[:, -1].copy())
    return metadata, features, targets


def load_experiences(paths):
    loaded = [load_experience(path) for path in paths]
    first = loaded[0][0]
    for path, (metadata, _, _) in zip(paths[1:], loaded[1:]):
        for key in (
            "kind",
            "dtype",
            "featureNames",
            "columns",
            "rulesVersion",
            "heuristicBotVersion",
            "gamma",
            "targetMode",
            "traceLambda",
        ):
            if metadata.get(key) != first.get(key):
                raise ValueError(f"experience {key} mismatch in {path}")

    metadata = dict(first)
    metadata["rows"] = sum(item[0]["rows"] for item in loaded)
    rounds = [item[0].get("rounds") for item in loaded]
    metadata["rounds"] = sum(rounds) if all(
        isinstance(value, int) for value in rounds
    ) else None
    metadata["workerCount"] = sum(
        item[0].get("workerCount") or 0 for item in loaded
    ) or None
    metadata["workerSeeds"] = [
        seed
        for item in loaded
        for seed in (item[0].get("workerSeeds") or [])
    ] or None
    metadata["sources"] = [
        {
            "path": os.path.abspath(path),
            "rows": item[0]["rows"],
            "rounds": item[0].get("rounds"),
            "policy": item[0].get("policy"),
        }
        for path, item in zip(paths, loaded)
    ]
    features = torch.cat([item[1] for item in loaded], dim=0)
    targets = torch.cat([item[2] for item in loaded], dim=0)
    return metadata, features, targets


def export_artifact(
    model,
    metadata,
    args,
    device,
    train_loss,
    validation_loss,
    selected_epoch,
):
    fc1_weight = model.fc1.weight.detach().cpu().tolist()
    fc1_bias = model.fc1.bias.detach().cpu().tolist()
    out_weight = model.out.weight.detach().cpu().squeeze(0).tolist()
    out_bias = float(model.out.bias.detach().cpu().item())
    return {
        "schemaVersion": 1,
        "kind": "chor-dai-dee-candidate-value",
        "featureNames": metadata["featureNames"],
        "hiddenSize": args.hidden,
        "parameters": {
            "w1": fc1_weight,
            "b1": fc1_bias,
            "w2": out_weight,
            "b2": out_bias,
        },
        "metadata": {
            "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "optimizer": "AdamW",
            "epochs": args.epochs,
            "selectedEpoch": selected_epoch,
            "batchSize": args.batch_size,
            "learningRate": args.learning_rate,
            "seed": args.seed,
            "device": str(device),
            "torchVersion": torch.__version__,
            "experienceRows": metadata["rows"],
            "experienceSources": metadata.get("sources"),
            "experienceKind": metadata.get("kind"),
            "experienceTargetMode": metadata.get("targetMode"),
            "experienceTraceLambda": metadata.get("traceLambda"),
            "experienceRounds": metadata.get("rounds"),
            "experienceWorkerCount": metadata.get("workerCount"),
            "experienceWorkerSeeds": metadata.get("workerSeeds"),
            "experienceTrajectories": metadata.get("trajectories"),
            "experienceSeed": metadata.get("seed"),
            "experienceSubject": metadata.get("subject"),
            "rulesVersion": metadata.get("rulesVersion"),
            "heuristicBotVersion": metadata.get("heuristicBotVersion"),
            "trainingLoss": train_loss,
            "validationLoss": validation_loss,
            "resumedFrom": os.path.basename(args.resume) if args.resume else None,
        },
    }


def load_artifact(model, artifact_path, feature_names):
    with open(artifact_path, "r", encoding="utf-8") as handle:
        artifact = json.load(handle)
    if artifact.get("kind") != "chor-dai-dee-candidate-value":
        raise ValueError("resume artifact is not a candidate-value model")
    if artifact.get("featureNames") != feature_names:
        raise ValueError("resume artifact feature schema does not match experience")
    if artifact.get("hiddenSize") != model.fc1.out_features:
        raise ValueError(
            f"resume hidden size {artifact.get('hiddenSize')} does not match "
            f"--hidden {model.fc1.out_features}"
        )
    parameters = artifact["parameters"]
    with torch.no_grad():
        model.fc1.weight.copy_(torch.tensor(parameters["w1"], dtype=torch.float32))
        model.fc1.bias.copy_(torch.tensor(parameters["b1"], dtype=torch.float32))
        model.out.weight.copy_(
            torch.tensor(parameters["w2"], dtype=torch.float32).unsqueeze(0)
        )
        model.out.bias.copy_(torch.tensor([parameters["b2"]], dtype=torch.float32))


def main():
    args = parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    metadata, features, targets = load_experiences(args.experience)
    device = select_device(args.device)
    print(
        f"device={device} rows={len(features)} "
        f"buffers={len(args.experience)} torch={torch.__version__}"
    )
    if device.type == "cuda":
        print(f"gpu={torch.cuda.get_device_name(0)}")

    validation_size = max(1, round(len(features) * args.validation_fraction))
    training_size = len(features) - validation_size
    split_generator = torch.Generator().manual_seed(args.seed)
    split = torch.randperm(len(features), generator=split_generator)
    validation_indices = split[:validation_size].to(device)
    training_indices = split[validation_size:].to(device)

    # Candidate rows are compact (about 116 MB per million examples). Keeping
    # them in VRAM avoids a Python DataLoader becoming the bottleneck on a fast
    # desktop GPU. Game generation remains in canonical JavaScript; only the
    # already-encoded public features cross this boundary.
    features = features.to(device)
    targets = targets.to(device)

    model = CandidateValueNetwork(features.shape[1], args.hidden)
    if args.resume:
        load_artifact(model, args.resume, metadata["featureNames"])
        print(f"resumed={args.resume}")
    model = model.to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.learning_rate, weight_decay=1e-5
    )
    loss_function = nn.MSELoss()
    final_train_loss = float("nan")
    final_validation_loss = float("nan")
    best_train_loss = float("nan")
    best_validation_loss = float("inf")
    best_epoch = 0
    best_state = None

    for epoch in range(args.epochs):
        epoch_started = time.perf_counter()
        model.train()
        loss_sum = 0.0
        examples = 0
        order = training_indices[
            torch.randperm(training_size, device=device)
        ]
        for start in range(0, training_size, args.batch_size):
            batch_indices = order[start:start + args.batch_size]
            batch_features = features[batch_indices]
            batch_targets = targets[batch_indices]
            optimizer.zero_grad(set_to_none=True)
            predicted = model(batch_features)
            loss = loss_function(predicted, batch_targets)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            loss_sum += float(loss.item()) * len(batch_features)
            examples += len(batch_features)
        final_train_loss = loss_sum / examples

        model.eval()
        loss_sum = 0.0
        examples = 0
        with torch.inference_mode():
            for start in range(0, validation_size, args.batch_size):
                batch_indices = validation_indices[start:start + args.batch_size]
                batch_features = features[batch_indices]
                batch_targets = targets[batch_indices]
                loss = loss_function(model(batch_features), batch_targets)
                loss_sum += float(loss.item()) * len(batch_features)
                examples += len(batch_features)
        final_validation_loss = loss_sum / examples
        print(
            f"epoch={epoch + 1:03d} train={final_train_loss:.6f} "
            f"validation={final_validation_loss:.6f} "
            f"seconds={time.perf_counter() - epoch_started:.2f}",
            flush=True,
        )
        if final_validation_loss < best_validation_loss:
            best_validation_loss = final_validation_loss
            best_train_loss = final_train_loss
            best_epoch = epoch + 1
            best_state = {
                name: value.detach().cpu().clone()
                for name, value in model.state_dict().items()
            }

    model.load_state_dict(best_state)
    print(
        f"selected-epoch={best_epoch:03d} "
        f"train={best_train_loss:.6f} validation={best_validation_loss:.6f}"
    )
    artifact = export_artifact(
        model,
        metadata,
        args,
        device,
        best_train_loss,
        best_validation_loss,
        best_epoch,
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
