import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import Checkpoint, { evm, createGetLoader, LogLevel } from '@snapshot-labs/checkpoint';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import * as writer from './writer';
import config from './config.json';
import Token from './abis/Token.json';
import GeneralPurposeFactory from './abis/GeneralPurposeFactory.json';

const dir = __dirname.endsWith('dist/src') ? '../' : '';
const schemaFile = path.join(__dirname, `${dir}../src/schema.gql`);
const schema = fs.readFileSync(schemaFile, 'utf8');

const PRODUCTION_INDEXER_DELAY = 60 * 1000;
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

if (process.env.CA_CERT) {
  process.env.CA_CERT = process.env.CA_CERT.replace(/\\n/g, '\n');
}

config.network_node_url = process.env.NETWORK_NODE_URL ?? config.network_node_url;

const indexer = new evm.EvmIndexer(writer);
const checkpoint = new Checkpoint(config, indexer, schema, {
  logLevel: LogLevel.Info,
  resetOnConfigChange: true,
  prettifyLogs: process.env.NODE_ENV !== 'production',
  abis: { Token, GeneralPurposeFactory }
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const server = new ApolloServer({
    schema: checkpoint.getSchema(),
    plugins: [ApolloServerPluginLandingPageLocalDefault({ footer: false })],
    introspection: true
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: PORT },
    context: async () => {
      const baseContext = checkpoint.getBaseContext();
      return {
        ...baseContext,
        getLoader: createGetLoader(baseContext)
      };
    }
  });

  console.log(`Listening at ${url}`);

  if (process.env.NODE_ENV === 'production') {
    console.log('Delaying indexer to prevent multiple processes indexing at the same time.');
    await sleep(PRODUCTION_INDEXER_DELAY);
  }

  // TODO: comments?
  await checkpoint.reset();
  await checkpoint.resetMetadata();
  console.log('Checkpoint ready');

  await checkpoint.start();
}

run();
