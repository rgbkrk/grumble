// kernelspecs lib lets you find jupyter kernels on disk
var kernelspecs = require("kernelspecs");

// Launch a kernel as a child process
var spawnteract = require("spawnteract");

// Rx library for connecting to a kernel
var enchannel = require("enchannel-zmq-backend");

// Little helpers for creating jupyter messages
var messaging = require("@nteract/messaging");

// Standard file system yo
var fs = require("fs");

// The dash that is low
var _ = require("lodash");

var chalk = require("chalk");
var treeify = require("treeify");

// Neat trick to sleep in an async/await setup
// > await sleep(100)
function sleep(duration) {
  return new Promise(resolve => setTimeout(resolve, duration));
}

const yargs = require("yargs");

async function main() {
  var ks = await kernelspecs.findAll();

  var argv = require("yargs")
    .default("kernel", function randomKernel() {
      return _.sample(ks).name;
    })
    .alias("k", "kernel")
    .describe("k", "the kernel to run")
    .nargs("k", 1).argv;

  const kernelName = argv.kernel;

  console.log(kernelName);

  await runKernel(ks[kernelName].spec);
}

// Let's launch a kernel, check its info, and execute code
async function runKernel(kernelSpec) {
  // Launch that kernel and get everything you need for cleanup
  var { config, spawn, connectionFile } = await spawnteract.launchSpec(
    kernelSpec,
    {
      cwd: "/tmp",
      // No STDIN, opt in to STDOUT and STDERR as node streams
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  console.log("Connection File: ", connectionFile);

  // Route everything that we won't get in messages to our own stdout
  spawn.stdout.on("data", data => {
    const text = data.toString();
    console.log("KERNEL STDOUT: ", text);
  });
  spawn.stderr.on("data", data => {
    const text = data.toString();
    console.log("KERNEL STDERR: ", text);
  });

  spawn.on("close", code => {
    if (code) {
      console.log("closed early and poorly", code);
      process.exit(code);
    }
  });

  //// OH SNAP, if it fails to launch above here we are waiting forever
  // Set up an Rx Subject to send and receive Jupyter messages
  var channel = await enchannel.createMainChannel(config);

  // Log every message we get back from the kernel
  var subscription = channel.subscribe(
    msg => {
      console.log(chalk.bold(msg.header.msg_type));
      console.log(
        treeify.asTree(_.omit(msg, ["buffers", "parent_header"]), true)
      );
    },
    err => console.error(err)
  );

  // 😴  sleep instead of setting up a Rx stream to send kernel info requests until we get a reply
  await sleep(200);
  channel.next(messaging.kernelInfoRequest());
  // 💤
  await sleep(200);
  channel.next(messaging.kernelInfoRequest());

  // BIG DATA
  channel.next(messaging.executeRequest("2 + 2"));

  // 😴  sleep so that our BIG DATA computation finishes
  await sleep(400);

  // Stop the child process for the kernel
  spawn.kill();

  // Close the subject
  channel.complete();

  // Close the subscription
  subscription.complete();

  // Clean up the connection file
  fs.unlinkSync(connectionFile);
}

main()
  .then(x => null)
  .catch(err => {
    console.error("main errored");
    console.error(err);
  });
