import { spawn } from 'node:child_process';

const withCoverage = process.argv.includes('--coverage');
if (withCoverage && !process.env.NODE_V8_COVERAGE) {
    throw new Error('Run coverage through npm run test:coverage');
}
for (const [script, args] of [
    [null, ['--test']],
    ['tests/browser-suite.mjs', []],
    ['tests/extension.browser.mjs', []],
]) {
    const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, script ? [script, ...args] : args, {
            stdio: 'inherit',
            env: {
                ...process.env,
                ...(withCoverage && script === 'tests/browser-suite.mjs'
                    ? { SIRTAB_COVERAGE_DIRECTORY: process.env.NODE_V8_COVERAGE }
                    : {}),
            },
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    if (code !== 0) process.exit(code);
}
