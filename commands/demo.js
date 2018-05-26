// Standard file system yo
var fs = require("fs");

var ops = require("rxjs/operators");

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

  process.on("SIGINT", () => {
    spawn.kill();
    // Clean up the connection file
    fs.unlinkSync(connectionFile);
  });

  //// OH SNAP, if it fails to launch above here we are waiting forever
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

  // 😴  sleep instead of setting up a Rx stream to send kernel info requests until we get a reply
  await sleep(2000);
  channels.next(messaging.kernelInfoRequest());
  // 💤
  await sleep(2000);
  channels.next(messaging.kernelInfoRequest());

  // BIG DATA
  channels.next(messaging.executeRequest("2 + 2"));
  // Wait for some big data
  await sleep(3000);

  // Stop the child process for the kernel
  spawn.kill();

  // Close the subject
  channels.complete();

  // Close the subscription
  subscription.complete();

  // Clean up the connection file
  fs.unlinkSync(connectionFile);
}

async function handler(argv) {
  console.log("running demo with ", argv.kernel);
  return await runKernel(argv.kernelspecs[argv.kernel].spec);
}

module.exports = {
  command: "demo",
  describe: "execute some demo code against a local kernel",
  handler
};
