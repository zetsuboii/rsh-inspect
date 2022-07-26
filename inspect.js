const fs = require("fs");
const stdin = process.stdin;

let data = '';

stdin.on('data', (chunk) => {
  data += chunk;
});

stdin.on('end', () => {
  inspectCompiled(data);
});

stdin.on('error', console.error);

const cyan = (x) => `\x1b[36m${x}\x1b[0m`;
const green = (x) => `\x1b[32m${x}\x1b[0m`;
const red = (x) => `\x1b[31m${x}\x1b[0m`;
const log = (x) => process.stdout.write(x);
const underscore = (x) => `\x1b[4m${x}\x1b[0m`;
const bright = (x) => `\x1b[1m${x}\x1b[0m`;

const ALL_HONEST_EXPLANATION = `* ${underscore("All")} participants were honest, meaning in this case `
  + `participants were abiding\n  ${cyan("check")} and ${cyan("assume")} statements `
  + `in your code's ${cyan(".only()")} blocks\n`;

const NO_HONEST_EXPLANATION = `* ${underscore("No")} participants were honest, meaning in this case `
  + `participants weren't following any rules specified in ${cyan(".only()")} `
  + `blocks. That means they are only limited by the checks (${cyan("require")} `
  + `and ${cyan("check")}) in your consensus step\n`;

const GENERIC_HONEST_EXPLANATION = (p) => `* Only ${p} was honest, meaning only ${p} `
  + `followed the rules specified by the local block checks\n`

const BALANCE_SUFFICIENT_MESSAGE = `* Failed assumption is "balance sufficient for transfer"\n`
  + `  This means, in this scenario, contract tried the spend funds that it didn't have\n`

const TOKEN_DESTROYED_MESSAGE = `* Failed assumption is "token destroyed at application exit"\n`
  + `  This means, in this scenario, token isn't destroyed before application finishes.`
  + `  In Reach contracts, if you create a token you have to destroy it before app closes`

const GENERIC_MESSAGE_EXPLANATION = (m) => `* Failed assumption is "${m}"\n`

const getAtExplanation = (file, line, column) => {
  const THRESHOLD = 3;

  const content = fs.readFileSync(__dirname + "/" + file).toString();
  const lines = content
    .split("\n")
    .map((l, i) => i + 1 == line ? bright(l) : l)
    .map((l, i) => `${red(String(i + 1).padStart(3))}  ${l}`)
    .filter((_, i) => i + 1 <= THRESHOLD + line && i + 1 > line - THRESHOLD)
    .join("\n")

  return `* Violation happened on these lines:\n`
    + `  [${file}:${line}:${column}]\n`
    + lines + `\n`
}
const HONESTIES = {
  "ALL": ALL_HONEST_EXPLANATION,
  "NO": NO_HONEST_EXPLANATION
}

const MESSAGES = {
  "balance sufficient for transfer": BALANCE_SUFFICIENT_MESSAGE,
  "token destroyed at application exit": TOKEN_DESTROYED_MESSAGE
}

/** @param {string} data */
function inspectCompiled(data) {
  log(cyan("Verification started\n"));
  const lines = data.split("\n");

  const VerifyState = Object.freeze({
    VERIFYING: 0,
    FAILED: 1,
    WITNESS: 2,
    FORMALIZE: 3,
    DONE: 4
  });

  let state = null;
  let lastVar = null;
  const vars = {}

  const fmtVars = (statement) => {
    for (const key of Object.keys(vars)) {
      statement = statement.replaceAll(key, vars[key].name);
    }

    return statement;
  }

  const getDeclareExplanation = ({ name, value, fnToGet, type }) => {
    return `  ${bright(fnToGet)} is called with ${cyan(value)}\n`
      + `> const ${bright(name)}: ${type} = ${cyan(value)}\n`;
  }

  const getWouldExplanation = ({ statement, name, value }) => {
    return `\n  If we'd declare\n`
      + `> const ${bright(name)} = ${fmtVars(statement)}\n`
      + `  ${bright(name)} would be ${cyan(value)}\n\n`
  }

  for (const line of lines) {
    if (line.includes("Verifying")) {
      switch (state) {
        case VerifyState.VERIFYING:
          log(`...${green("OK")}\n`);
          break;
        case VerifyState.FAILED:
          log(`--------------------------------------------------------------------------------\n\n`);
          break;
        case VerifyState.FORMALIZE:
          log(red(`=================================================================================\n\n`));
          break;
      }

      state = VerifyState.VERIFYING;

      log("- " + line.trimStart().trimEnd())
      continue;
    }

    if (line.includes("Verification failed:")) {
      switch (state) {
        case VerifyState.VERIFYING:
          log(`...${red("FAILED")}\n`);
          break;
      }

      state = VerifyState.FAILED;
      log("\n");
      log(red(line + "\n"));
      log("Reach found a scenario where one ouf our security assumptions is violated\n");
      continue;
    }

    /** @param {string} line */
    const getHonesty = (line) => line
      .split("when ")[1]
      .split(" ")[0];

    /** @param {string} line */
    const getMessage = (line) => line
      .split("msg: ")[1]
      .replace("\"", "")
      .replace("\"", "")

    /** @param {string} line */
    const getAt = (line) => line
      .split("at")[1]
      .split(":")
      .slice(0, 3)
      .map(item => item.trimStart())

    if (state == VerifyState.FAILED) {

      if (line.includes("when")) {
        const honesty = getHonesty(line);
        const honestyExplanation = HONESTIES[honesty];
        log(honestyExplanation ?? GENERIC_HONEST_EXPLANATION(honesty));
        continue;
      }

      if (line.includes("msg:")) {
        const message = getMessage(line);
        const messageExplanation = MESSAGES[message];
        log(messageExplanation ?? GENERIC_MESSAGE_EXPLANATION(message));
        continue;
      }

      if (line.includes("at") && line.includes(".rsh")) {
        const [fileName, fileLine, fileColumn] = getAt(line)
        log(getAtExplanation(fileName, Number(fileLine), Number(fileColumn)))
        continue;
      }
    }

    if (line.includes("Violation Witness")) {
      state = VerifyState.WITNESS;
      log("\n")
      log(red("=============================== VIOLATION WITNESS ===============================\n"));
      log(red("                  Here's a scenario where the violation happens                  \n"));
      log(red(`=================================================================================\n`));
      continue;
    }

    if (line.includes("Theorem Formalization")) {
      state = VerifyState.FORMALIZE;
      log("\n  After these declarations:\n");
      continue;
    }

    if (state == VerifyState.WITNESS) {
      const declareReachRegex = /const (\w+)\s*=/
      const declareRegex = /const (.*) = protect<(.*)>\((.*)\)/
      const couldRegex = /.*could = (.*)/
      const fromRegex = /.*from: (.*):\w*/

      if (declareRegex.test(line)) {
        const [varHandle, type, fnToGet] = declareRegex.exec(line).slice(1, 4);
        vars[varHandle] = {
          type,
          fnToGet: fnToGet.replace("\"", "").replace("\"", ""),
          value: null,
          name: null
        };
        lastVar = varHandle;
        continue;
      }
      else if (couldRegex.test(line)) {
        const [value] = couldRegex.exec(line).slice(1, 2);
        vars[lastVar].value = value;
        continue;
      }
      else if (fromRegex.test(line)) {
        const [fileName, fileLine] = fromRegex.exec(line).slice(1, 2)[0].split(":");
        const content = fs.readFileSync(fileName)
          .toString()
          .split("\n")
          .filter((_l, i) => i + 1 == fileLine)[0]

        const varName = declareReachRegex.exec(content).slice(1, 2)[0]
        vars[lastVar].name = varName;
        log(getDeclareExplanation(vars[lastVar]))
        lastVar = null;
        continue;
      }
    }

    if (state == VerifyState.FORMALIZE) {
      const declareRegex = /const (.+)\s*=\s*(.*);/
      const wouldRegex = /.*would be (.*)/

      if (declareRegex.test(line)) {
        const [varHandle,statement] = declareRegex.exec(line).slice(1, 3)
        vars[varHandle] = { statement, name: varHandle };
        lastVar = varHandle;
        continue;
      } else if (wouldRegex.test(line)) {
        const [value] = wouldRegex.exec(line).slice(1, 2)
        vars[lastVar].value = value;
        log(getWouldExplanation(vars[lastVar]));
        lastVar = null;
        continue;
      }

      if (!/^\s*$/.test(line))
        console.log(fmtVars(line));
    }

  }

  switch (state) {
    case VerifyState.VERIFYING:
      log(`...${green("OK")}\n`);
      break;
    case VerifyState.FAILED:
      log(`--------------------------------------------------------------------------------\n\n`);
  }
}
