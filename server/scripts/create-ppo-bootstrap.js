#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PPOModel } = require('../game/PPOModel');

const output = path.resolve(
    process.argv[2] || 'ai/ppo-policy-heuristic-bootstrap.json');
const actorHiddenSize = Number(process.argv[3]) || 64;
const criticHiddenSize = Number(process.argv[4]) || 64;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
    output,
    `${JSON.stringify(PPOModel.heuristicBootstrap({
        actorHiddenSize,
        criticHiddenSize
    }))}\n`
);
console.log(`checkpoint=${output}`);
