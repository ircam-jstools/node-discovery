const { DiscoveryServer } = require('../dist/index');

const server = new DiscoveryServer({ verbose: true });

server.addListener('connection', (client, clients) => {
  // console.log('connection: client', client);
  // console.log('connection: clients', clients.size);
});

server.addListener('close', (client, clients) => {
  // console.log('close: client', client);
  // console.log('close: clients', clients.size);
});

server.start();

const exitHandler = () => {
  try {
    server.stop();
  } catch (error) {
    // no throwing any more
  }
};

// do something when app is closing
process.on('exit', () =>
           {
             console.log('exit');
             exitHandler();
           });
// catches ctrl+c event
process.on('SIGINT', () =>
           {
             console.log('SIGINT');
             exitHandler();
           });
// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', () =>
           {
             console.log('SIGUSR1');
             exitHandler();
           });
process.on('SIGUSR2', () =>
           {
             console.log('SIGUSR2');
             exitHandler();
           });
// catches uncaught exceptions
process.on('uncaughtException', () =>
           {
             console.log('Uncaught exception');
             exitHandler();
           });
