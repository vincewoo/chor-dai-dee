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
    parser.add_argument("--experience", required=True)
    parser.add_argument("--output", required=True)
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


def export_artifact(model, metadata, args, device, train_loss, validation_loss):
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
            "batchSize": args.batch_size,
            "learningRate": args.learning_rate,
            "seed": args.seed,
            "device": str(device),
            "torchVersion": torch.__version__,
            "experienceRows": metadata["rows"],
            "experienceRounds": metadata["rounds"],
            "experienceSeed": metadata["seed"],
            "rulesVersion": metadata["rulesVersion"],
            "heuristicBotVersion": metadata["heuristicBotVersion"],
            "trainingLoss": train_loss,
            "validationLoss": validation_loss,
        },
    }


def main():
    args = parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    metadata, features, targets = load_experience(args.experience)
    device = select_device(args.device)
    print(f"device={device} rows={len(features)} torch={torch.__version__}")
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

    model = CandidateValueNetwork(features.shape[1], args.hidden).to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.learning_rate, weight_decay=1e-5
    )
    loss_function = nn.MSELoss()
    final_train_loss = float("nan")
    final_validation_loss = float("nan")

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

    artifact = export_artifact(
        model, metadata, args, device, final_train_loss, final_validation_loss
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
