import { DiscoveryServer } from '../src/index';

const server = new DiscoveryServer({ verbose: true });

server.addListener('connection', (client, clients) => {
  console.log('connection: client', client);
  console.log('connection: clients', clients);
});

server.addListener('close', (client, clients) => {
  console.log('close: client', client);
  console.log('close: clients', clients);
});
