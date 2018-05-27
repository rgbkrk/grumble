// Standard file system yo
var fs = require("fs");

var ops = require("rxjs/operators");

var fso = require("fs-observable");

// The dash that is low
var _ = require("lodash");

var chalk = require("chalk");
var treeify = require("treeify");
// Neat trick to sleep in an async/await setup
// > await sleep(100)
function sleep(duration) {
  return new Promise(resolve => setTimeout(resolve, duration));
}

// Launch a kernel as a child process
var spawnteract = require("spawnteract");

// Rx library for connecting to a kernel
var enchannel = require("enchannel-zmq-backend");

// Little helpers for creating jupyter messages
var messaging = require("@nteract/messaging");

async function runNotebook(context) {
  const data = await fso.readFileObservable(context.file).toPromise();
  const rawNotebook = JSON.parse(data);
  console.log(rawNotebook);

  console.log(rawNotebook.cells);

  // get kernel, unless overridden by context
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
    console.log(code);
    if (code) {
      console.log("closed early and poorly", code);
      process.exit(code);
    }
    // If the process ends early, we should too in this case
    process.exit(0);
  });

  process.on("SIGINT", what => {
    // Try to kill the process
    try {
      spawn.kill();
    } catch (e) {}
    // Clean up the connection file
    try {
      fs.unlinkSync(connectionFile);
    } catch (e) {}
    process.exit(1);
  });

  //// OH SNAP, if it fails to launch yet doesn't die above here we are possibly waiting forever
  // Set up an Rx Subject to send and receive Jupyter messages
  var channels = await enchannel.createMainChannel(config);

  // Log every message we get back from the kernel
  var subscription = channels.subscribe(
    msg => {
      console.log(chalk.bold(msg.header.msg_type));
      console.log(
        treeify.asTree(_.omit(msg, ["buffers", "parent_header"]), true)
      );
    },
    err => console.error(err)
  );

  console.log("sending messages");
  // 😴  sleep instead of setting up a Rx stream to send kernel info requests until we get a reply
  await sleep(200);
  channels.next(messaging.kernelInfoRequest());
  // 💤
  await sleep(200);
  channels.next(messaging.kernelInfoRequest());

  // BIG DATA
  channels.next(messaging.executeRequest("2 + 2"));
  // Wait for some big data
  await sleep(300);

  // Stop the child process for the kernel
  spawn.kill();

  // Close the subject
  channels.complete();

  // Close the subscription
  subscription.complete();

  // Clean up the connection file
  fs.unlinkSync(connectionFile);
}

function builder(yargs) {
  return yargs.option("file", {
    alias: "f",
    describe: "the file / notebook to run",
    type: "string",
    demandOption: true
  });
}

module.exports = {
  command: "collect",
  describe: "run a notebook",
  builder,
  handler: runNotebook
};
