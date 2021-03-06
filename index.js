const shelljs = require('shelljs');
const fs = require('fs');
const debugFactory = require('debug');
debugFactory.enable('*');
const debug = debugFactory('api-generator');

const defaultUrl = 'http://localhost:4000';
const openApiPath = '/openapi-json'
const healthEndpoint = '/api/health/is_alive';
const outDir = './apiPackage'
const sleep = (n = 100) => new Promise(resolve => setTimeout(resolve, n));

/**
 * 
 * @param {() => boolean | Promise<boolean> } fn 
 * @param {number} interval 
 */
const waitUntil = async (fn, interval = 500) => {
  const timeout = 30000;
  const timeStart = Date.now();
  while (true) {
    const rv = await fn();
    if (rv) {
      return;
    }
    if (Date.now() - timeStart > timeout) {
      throw new Error('waitUntil: timeout reached')
    } 
    await sleep(interval);
  }    
}

const isServerAlive = () => {
  debug('checking if server is alive...');
  const rv = shelljs.exec(`curl -f ${defaultUrl}${healthEndpoint}`, {silent: true});
  return rv.code === 0;
}

const downloadOpenApi = () => {
  shelljs.exec(`curl -f ${defaultUrl}${openApiPath} > openapi.json`, {silent: true});
}

// const getGeneratorExecutable = () => {
//   const path = require.resolve('@openapitools/openapi-generator-cli', {paths: [__dirname]});
// }

const generateApiCode = () => {
  return new Promise((resolve, reject) => 
  shelljs.exec(`node ${__dirname}/node_modules/.bin/openapi-generator-cli generate -i openapi.json -g typescript -o ${outDir}`, (code, stdout, stderr) => {
    if (code !== 0) {
      reject(new Error(stderr));
    }
    resolve();
  }));
}
  

const getBranchName = () => {
  return shelljs.exec(`git rev-parse --abbrev-ref HEAD`).stdout.replace('\n', '');
}

const getCurrentPackageInformation = () => {
  const pkgJson = JSON.parse(fs.readFileSync('package.json', {'encoding': 'utf-8'}));
  const {repository, version, name} = pkgJson;
  return {repository, version, name};
}


const writeApiPackageJson = ({repository, version, name}) => {
  const branchName = getBranchName();
  const pkgJson = JSON.parse(fs.readFileSync('package.json', {'encoding': 'utf-8'}));
  
  pkgJson.version = version + (branchName === 'main' ? '' : `-${branchName}`);
  pkgJson.name = name + '-api';
  pkgJson.repository = repository;

  fs.writeFileSync('package.json', JSON.stringify(pkgJson, null, 2), 'utf-8');
}

const writeNpmrc  = () => {
  const content = `//npm.pkg.github.com/:_authToken=` + '${GITHUB_PACKAGES_TOKEN}' + `
@retrain-ai:registry=https://npm.pkg.github.com`;
fs.writeFileSync('.npmrc', content, 'utf-8');
}

const main = async() => {
  debug('running server');
  const webServer = shelljs.exec('npm start', {async: true});
  await waitUntil(isServerAlive);
  
  debug('downloading openapi json file');
  downloadOpenApi();
  
  debug('killing server');
  //TODO: kill server
  shelljs.exec(`kill ${webServer.pid}`)
  debug('killed server')

  debug('generating api code');
  await generateApiCode().catch(e => {
    console.error(e);
    shelljs.exit(-1);
  })
  const packageInfo = getCurrentPackageInformation();

  shelljs.cd(outDir);

  debug('running npm install');
  shelljs.exec('npm i');
  
  writeApiPackageJson(packageInfo);
  writeNpmrc();

  debug('publishing');
  shelljs.touch('.npmignore');
  shelljs.exec('npm publish', {fatal: true});
  shelljs.exit()
}
main().catch(console.log);