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

// Neat trick to sleep in an async/await setup
// > await sleep(100)
function sleep(duration) {
  return new Promise(resolve => setTimeout(resolve, duration));
}

// Let's launch a kernel, check its info, and execute code
async function main() {
  var { spec } = await kernelspecs.find("python3");

  // Launch that kernel and get everything you need for cleanup
  var { config, spawn, connectionFile } = await spawnteract.launchSpec(spec, {
    cwd: "/tmp",
    // No STDIN, opt in to STDOUT and STDERR as node streams
    stdio: ["ignore", "pipe", "pipe"]
  });

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

  // Set up an Rx Subject to send and receive Jupyter messages
  var channel = await enchannel.createMainChannel(config);

  // Log every message we get back from the kernel
  var subscription = channel.subscribe(
    x => console.log(x),
    err => console.error(err)
  );

  // 😴  sleep instead of setting up a Rx stream to send kernel info requests until we get a reply
  await sleep(200);
  channel.next(messaging.kernelInfoRequest());
  // 💤
  await sleep(200);
  channel.next(messaging.kernelInfoRequest());

  // BIG DATA
  channel.next(messaging.executeRequest("print(2 + 2)"));

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
