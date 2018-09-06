import dgram from 'dgram';
import os from 'os';
import { EventEmitter } from 'events';
import { getTime } from './utils';
import { BROADCAST_PORT } from './config';

function getKey(rinfo) {
  return rinfo.address + ':' + rinfo.port;
}

const MONITOR_INTERVAL = 1000; // ms
const DISCONNECT_TIMEOUT = 4; // s

/**
 * Create a server that waits for new connection from DiscoveryClient.
 *
 * @example
 * import { DiscoveryServer } from '@ircam/node-discovery'
 *
 * const server = new DiscoveryServer();
 * server.on('connection', (rinfo, list) => console.log('connection', rinfo, list));
 * server.on('close', list => console.log('close', list));
 */
class DiscoveryServer extends EventEmitter {
  constructor({
    broadcastPort = BROADCAST_PORT,
    verbose = false
  } = {}) {
    super();

    this.broadcastPort = broadcastPort;
    this.verbose = verbose;
    this.clients = new Map();

    this._monitorClients = this._monitorClients.bind(this);
  }

  /**
   * Start the server.
   */
  start() {
    this._setupSocket();
    this._monitorIntervalId = setInterval(this._monitorClients, MONITOR_INTERVAL);
  }

  /**
   * Stop the server
   */
  stop() {
    this.udp.close();
  }

  /**
   * Send a message to a client.
   *
   * @param {String} msg - Message to send.
   * @param {Number} port - Port of the client.
   * @param {String} address - Ip address of the client.
   */
  send(msg, port, address) {
    if (this.udp) {
      const buf = Buffer.from(msg);
      this.udp.send(buf, 0, buf.length, port, address);
    }
  }

  _setupSocket() {
    this.udp = dgram.createSocket('udp4');

    let _rinfo = null;

    this.udp.on('message', (buffer, rinfo) => {
      const msg = buffer.toString().split(' ');

      // socket is used for something else
      if (msg[0] !== 'DISCOVERY_HANDSHAKE' && msg[0] !== '0') {
        this.emit('message', buffer, rinfo);
      } else {
        const key = getKey(rinfo);

        if (!this.clients.has(key))
          this._receiveHandshake(msg, rinfo);
        else
          this._receivePing(msg, rinfo);
      }
    });

    this.udp.bind(this.broadcastPort, () => {
      if (this.verbose)
        console.log('binded server at:', this.udp.address());
    });
  }

  _receiveHandshake(msg, rinfo) {
    const key = getKey(rinfo);
    const lastSeen = getTime();
    const payload = JSON.parse(msg[1]);
    const client = { rinfo, lastSeen, payload };

    this.clients.set(key, client);
    this.emit('connection', client, this.clients);

    if (this.verbose) {
      console.log('> connection:', client);
      console.log('> connected clients:', this.clients);
    }

    const ack = Buffer.from('1');
    this.udp.send(ack, 0, ack.length, rinfo.port, rinfo.address);
  }

  _receivePing(msg, rinfo) {
    const now =  getTime();
    const key = getKey(rinfo);
    const client = this.clients.get(key);
    client.lastSeen = now;
    // send pong
    const pong = Buffer.from('1');
    this.udp.send(pong, 0, pong.length, rinfo.port, rinfo.address);
  }

  _monitorClients() {
    const now = getTime();

    for (let [key, client] of this.clients.entries()) {
      const { lastSeen } = client;

      if (now - lastSeen > DISCONNECT_TIMEOUT) {
        this.clients.delete(key);
        this.emit('close', client, this.clients);

        if (this.verbose) {
          console.log('> close:', client);
          console.log('> connected clients:', this.clients);
        }
      }
    }
  }
}

export default DiscoveryServer;
