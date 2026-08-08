// Node-only checkpoint loading. Model evaluation itself is dependency-free and
// can be bundled into the browser; keeping fs here prevents that browser graph
// from acquiring a Node builtin merely to support command-line scripts.

const fs = require('fs');
const { PPOModel } = require('./PPOModel');
const { RLValueModel } = require('./RLValueModel');

function readArtifact(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadPPOModel(filePath) {
    return new PPOModel(readArtifact(filePath));
}

function loadRLValueModel(filePath) {
    return RLValueModel.fromArtifact(readArtifact(filePath));
}

module.exports = { readArtifact, loadPPOModel, loadRLValueModel };
