const fs = require('fs');
const path = require('path');

function loadWf(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'workflows', file), 'utf8'));
}
function getCode(wf, nodeName) {
  const n = wf.nodes.find(x => x.name === nodeName);
  if (!n) throw new Error('Node not found: ' + nodeName);
  return n.parameters.jsCode;
}

// Build a runnable function out of n8n Code-node source given mock context.
// Supports $input.first()/.all(), $json (bound to first input item), $vars,
// $( 'Node Name' ) .first()/.all() via a registry, $execution, $workflow, $credentials.
function run(code, { inputItems, vars = {}, nodeRegistry = {}, execution = {id:'exec-test-1'}, workflow = {id:'wf-test',name:'Test WF'}, credentials = {} }) {
  const $input = {
    first: () => inputItems[0],
    all: () => inputItems,
  };
  const $json = inputItems[0] ? inputItems[0].json : undefined;
  const $vars = vars;
  const $execution = execution;
  const $workflow = workflow;
  const $credentials = credentials;
  const $ = (name) => {
    const items = nodeRegistry[name];
    if (!items) throw new Error('Unknown node ref: ' + name);
    return { first: () => items[0], all: () => items };
  };
  const fn = new Function('$input', '$json', '$vars', '$', '$execution', '$workflow', '$credentials', 'require', code);
  return fn($input, $json, $vars, $, $execution, $workflow, $credentials, require);
}

module.exports = { loadWf, getCode, run };
