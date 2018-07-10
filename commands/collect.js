// @flow
// Standard file system yo
var fs = require("fs");

const yargs = require("yargs");

import { first, map, mapTo, filter, tap } from "rxjs/operators";

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

type DiskSource = string | Array<string>;

type DiskCodeCell = {
  cell_type: "code",
  source: DiskSource
};

type DiskMarkdownCell = {
  cell_type: "markdown",
  source: DiskSource
};

type DiskCell = DiskCodeCell | DiskMarkdownCell;

type DiskNotebook = {
  metadata: Object,
  cells: Array<DiskCell>
};

function prettyMessage(msg) {
  console.log(chalk.bold(msg.header.msg_type));
  console.log(treeify.asTree(_.omit(msg, ["buffers", "parent_header"]), true));
}

type Context = {
  kernelspecs: {
    [string]: {
      name: string,
      spec: Object
    }
  },
  file: string
};

async function runNotebook(context: Context) {
  const data = await fso.readFileObservable(context.file).toPromise();
  const rawNotebook: DiskNotebook = JSON.parse(data.toString());

  // Still to this day I don't know how I check a raw object to make sure it
  // AND type cast it to a flow type that is validated

  // Pick out the kernel name from the notebook
  const kernelName = _.get(
    _.find(
      _.pick(rawNotebook.metadata, [
        "kernel_info.name",
        "kernelspec.name",
        "language_info.name"
      ]),
      ({ name }) => name
    ),
    "name",
    "python3"
  );

  let kernelspec = context.kernelspecs[kernelName];
  if (!kernelspec) {
    kernelspec = _.find(
      context.kernelspecs,
      ks => ks.spec.language === kernelName
    );
  }

  var { config, spawn, connectionFile } = await spawnteract.launchSpec(
    kernelspec.spec,
    {
      cwd: "/tmp",
      // No STDIN, opt in to STDOUT and STDERR as node streams
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let hasStarted = false;

  // Route everything that we won't get in messages to our own stdout
  spawn.stdout.on("data", data => {
    hasStarted = true;
    const text = data.toString();
    console.error(chalk.bold.yellow("-- KERNEL STDOUT --"));
    console.error(chalk.dim.yellow(text));
  });
  spawn.stderr.on("data", data => {
    hasStarted = true;
    const text = data.toString();
    console.error(chalk.bold.red("KERNEL STDERR: "));
    console.error(chalk.dim.red(text));
  });

  spawn.on("close", code => {
    if (code) {
      console.error("closed early and poorly", code);
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

  const messageCollections = {};

  //// OH SNAP, if it fails to launch yet doesn't die above here we are possibly waiting forever
  // Set up an Rx Subject to send and receive Jupyter messages
  // $FlowFixMe
  var channels: rxjs$Subject<
    JupyterMessage<any, any>
  > = await enchannel.createMainChannel(config);

  var subscription = channels.subscribe(
    msg => {
      if (msg.parent_header && typeof msg.parent_header.msg_id === "string") {
        const parent_id = msg.parent_header.msg_id;

        // Collect all messages
        const messages = _.get(messageCollections, parent_id, []);
        messages.push(msg);
        messageCollections[parent_id] = messages;
        // prettyMessage(msg);
      }
    },
    err => console.error(err)
  );

  while (!hasStarted) {
    await sleep(60);
    // we are expecting some stdout or stderr first because not all kernels
    // are all that responsive
  }

  // Set up a receiver for kernel info
  let kernelInfo = null;
  channels
    .pipe(
      messaging.ofMessageType("kernel_info_reply"),
      first(),
      map(msg => msg.content)
    )
    .subscribe(content => {
      kernelInfo = content;
    });

  // Keep trying to get kernel info
  while (!kernelInfo) {
    // Send the message until we've got it
    channels.next(messaging.kernelInfoRequest());
    await sleep(60);
  }

  for (var cell: DiskCell of rawNotebook.cells) {
    const source = Array.isArray(cell.source)
      ? cell.source.join("")
      : cell.source;

    // Send execution
    // Technically this should come after we've set up the
    // subscription below
    const executionMessage = messaging.executeRequest(source);
    channels.next(executionMessage);

    let errored = false;

    // We should break on an error
    channels
      .pipe(
        messaging.childOf(executionMessage),
        messaging.ofMessageType("execute_reply"),
        filter(msg => msg.content.status === "error"),
        mapTo(true),
        first()
      )
      .subscribe(m => {
        errored = true;
      });

    // Know that we can execute the next one when we get an idle for
    // the prior id
    await channels
      .pipe(
        messaging.childOf(executionMessage),
        messaging.ofMessageType("status"),
        filter(msg => msg.content.execution_state === "idle"),
        mapTo(true),
        first()
      )
      .toPromise();

    // So hacky that we wait on the `idle` happening
    if (errored) {
      break;
    }
  }

  _.forEach(messageCollections, (collection, parent_id) => {
    collection.forEach(msg => {
      if (!msg.content) {
        return;
      }
      console.log(chalk.bold(msg.header.msg_type));
      console.log(treeify.asTree(msg.content, true));
    });
  });

  /** CLEAN UP **/

  // Ideally, we'd send a shutdown request before all this

  // Close the zeromq socket
  channels.complete();
  // Close the subscription
  subscription.unsubscribe();

  // Stop the child process for the kernel
  spawn.kill();

  // Clean up the connection file
  fs.unlinkSync(connectionFile);
}

function builder(yargs: yargs) {
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
