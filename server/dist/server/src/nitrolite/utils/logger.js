import chalk from 'chalk';
const LOG_LEVELS = {
    system: { color: chalk.bold.cyan, label: 'SYSTEM' },
    nitro: { color: chalk.bold.hex('#9900FF'), label: 'YELLOW' },
    auth: { color: chalk.bold.hex('#FF8800'), label: 'AUTH' },
    ws: { color: chalk.bold.hex('#00AAFF'), label: 'WS' },
    game: { color: chalk.bold.hex('#00FF99'), label: 'GAME' },
    success: { color: chalk.bold.green, label: 'OK' },
    warn: { color: chalk.bold.yellow, label: 'WARN' },
    error: { color: chalk.bold.red, label: 'ERROR' },
    info: { color: chalk.bold.blue, label: 'INFO' },
    debug: { color: chalk.bold.magenta, label: 'DEBUG' },
    data: { color: chalk.hex('#888888'), label: 'DATA' },
};
const timestamp = () => {
    const now = new Date();
    const time = now.toTimeString().split(' ')[0];
    return chalk.dim(`[${time}]`);
};
const formatLabel = ({ color, label }) => {
    return color(label.padEnd(8, ' '));
};
const print = (level, message, args, formatter) => {
    const prefix = formatLabel(LOG_LEVELS[level]);
    const body = formatter ? formatter(message) : message;
    console.log(timestamp(), prefix, body, ...args);
};
const printWarn = (message, args) => {
    const prefix = formatLabel(LOG_LEVELS.warn);
    console.warn(timestamp(), prefix, chalk.yellow(message), ...args);
};
const printError = (message, args) => {
    const prefix = formatLabel(LOG_LEVELS.error);
    console.error(timestamp(), prefix, chalk.red(message), ...args);
};
export const logger = {
    system: (message, ...args) => print('system', message, args),
    nitro: (message, ...args) => print('nitro', message, args),
    auth: (message, ...args) => print('auth', message, args),
    ws: (message, ...args) => print('ws', message, args),
    game: (message, ...args) => print('game', message, args),
    success: (message, ...args) => print('success', message, args, chalk.green),
    warn: (message, ...args) => printWarn(message, args),
    error: (message, ...args) => printError(message, args),
    info: (message, ...args) => print('info', message, args),
    debug: (message, ...args) => print('debug', message, args, chalk.dim),
    data: (label, data) => {
        const formattedLabel = chalk.cyan.bold(`${label}:`);
        const prefix = formatLabel(LOG_LEVELS.data);
        if (typeof data === 'object' && data !== null) {
            console.log(timestamp(), prefix, formattedLabel);
            console.log(chalk.dim(JSON.stringify(data, null, 2)));
        }
        else {
            console.log(timestamp(), prefix, formattedLabel, data);
        }
    },
    divider: () => {
        console.log(chalk.dim('-'.repeat(80)));
    },
    section: (title) => {
        console.log();
        console.log(chalk.bold.white(`+${'-'.repeat(78)}+`));
        console.log(chalk.bold.white(`| ${title.padEnd(76)} |`));
        console.log(chalk.bold.white(`+${'-'.repeat(78)}+`));
    },
};
export default logger;
