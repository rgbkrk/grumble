// @flow
// kernelspecs lib lets you find jupyter kernels on disk
var kernelspecs = require("kernelspecs");

// The dash that is low
var _ = require("lodash");
const yargs = require("yargs");

const commands = require("./commands");

const demo = require("./commands/demo");

async function main() {
  const context = {};
  context.kernelspecs = await kernelspecs.findAll();

  const parser = yargs
    .default("kernel", function randomKernel() {
      const name = _.sample(context.kernelspecs).name;
      return name;
    })
    .alias("k", "kernel")
    .describe("k", "the kernel to run")
    .nargs("k", 1)
    .config(context);

  // Load each command dynamically
  commands.all.forEach(command => parser.command(command));
  parser.argv;
}

main()
  .then(x => null)
  .catch(err => {
    console.error("main errored");
    console.error(err);
  });
