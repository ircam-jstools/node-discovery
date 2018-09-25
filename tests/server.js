import { DiscoveryServer } from '../src/index';

const server = new DiscoveryServer({ verbose: false });

server.addListener('connection', (client, clients) => {
  // console.log('connection: client', client);
  // console.log('connection: clients', clients.size);
});

server.addListener('close', (client, clients) => {
  // console.log('close: client', client);
  // console.log('close: clients', clients.size);
});

server.start();

// const exitHandler = () => server.stop();

// // do something when app is closing
// process.on('exit', exitHandler);
// // catches ctrl+c event
// process.on('SIGINT', exitHandler);
// // catches "kill pid" (for example: nodemon restart)
// process.on('SIGUSR1', exitHandler);
// process.on('SIGUSR2', exitHandler);
// // catches uncaught exceptions
// process.on('uncaughtException', exitHandler);
