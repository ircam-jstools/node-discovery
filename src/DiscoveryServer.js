import dgram from 'dgram';
import os from 'os';
import { EventEmitter } from 'events';
import { getTime } from './utils';
import { BROADCAST_PORT } from './config';

function getKey(rinfo) {
  return rinfo.address + ':' + rinfo.port;
}

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
    monitorInterval = 2000, // ms
    disconnectTimeout = 10000, // ms
    verbose = false
  } = {}) {
    super();

    this.broadcastPort = broadcastPort;
    this.verbose = verbose;
    this.clients = new Map();

    this.monitorInterval = monitorInterval;
    this.disconnectTimeout = disconnectTimeout;

    this._receiveDiscoverReq.bind(this);
    this._sendDiscoverAck.bind(this);

    this._receiveConnectReq.bind(this);
    this._sendConnectAck.bind(this);

    this._receiveKeepaliveReq.bind(this);
    this._sendKeepaliveAck.bind(this);

    this._monitorClients = this._monitorClients.bind(this);
    this.send = this.send.bind(this);
  }

  /**
   * Start the server.
   */
  start() {
    this._setupSocket();
    this._monitorIntervalId = setInterval(this._monitorClients, this.monitorInterval);
  }

  /**
   * Stop the server
   */
  stop() {
    clearInterval(this._monitorIntervalId);
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

      if(this.verbose) {
        console.log('send: ', msg);
      }
    }
  }

  _setupSocket() {
    this.udp = dgram.createSocket({
      type: 'udp4',
      // use SO_REUSEADDR or SO_REUSEPORT depending on OS
      // it might help with firewall, but seems insufficient
      // see https://stackoverflow.com/questions/25586327/bizarre-firewall-related-socket-leak-on-mac-os-x
      reuseAddr: true,
    });

    this.udp.on('message', (buffer, rinfo) => {
      const msg = buffer.toString().split(' ');

      if(this.verbose) {
        console.log('receive: ', msg);
      }

      switch(msg[0]) {
        case 'DISCOVER_REQ': {
          this._receiveDiscoverReq(msg, rinfo);
          break;
        }
        case 'CONNECT_REQ': {
          this._receiveConnectReq(msg, rinfo);
          break;
        }
        case 'KEEPALIVE_REQ': {
          this._receiveKeepaliveReq(msg, rinfo);
          break;
        }
        case 'ERROR': {
          this._receiveError(msg, rinfo);
          break;
        }
        default: {
          // forward any message that are not related to the protocol
          this.emit('message', buffer, rinfo);
          break;
        }
      }
    });

    this.udp.bind(this.broadcastPort, () => {
      if (this.verbose) {
        console.log('binded server at:', this.udp.address());
      }
    });
  }

  _receiveDiscoverReq(msg, rinfo) {
    // unconditional
    this._sendDiscoverAck(msg, rinfo);
  }

  _sendDiscoverAck(msg, rinfo) {    const messageId = parseInt(msg[1]);
    this.send('DISCOVER_ACK ' + messageId, rinfo.port, rinfo.address);
  }

  _receiveConnectReq(msg, rinfo) {
    const key = getKey(rinfo);

    if (this.clients.has(key)) {
      this._disconnectClient(key);
      this._sendError(msg, rinfo);
    } else {
      let payload = null;
      try {
        payload = JSON.parse(msg[2]);
      } catch(e) {
        payload = {};
      }
      this._connectClient(key, rinfo, payload);
      this._sendConnectAck(msg, rinfo);
    }
  }

  _sendConnectAck(msg, rinfo) {
    const messageId = parseInt(msg[1]);
    this.send('CONNECT_ACK ' + messageId, rinfo.port, rinfo.address);
  }


  _receiveKeepaliveReq(msg, rinfo) {
    const key = getKey(rinfo);

    if (!this.clients.has(key)) {
      this._sendError(msg, rinfo);
    } else {
      const client = this.clients.get(key);
      client.lastSeen = getTime();
      this._sendKeepaliveAck(msg, rinfo);
    }
  }

  _sendKeepaliveAck(msg, rinfo) {
    const messageId = parseInt(msg[1]);
    this.send('KEEPALIVE_ACK ' + messageId, rinfo.port, rinfo.address);
  }

  _receiveError(msg, rinfo) {
    const key = getKey(rinfo);

    if (this.clients.has(key)) {
      this._disconnectClient(key);
    }
    this._sendError(msg, rinfo);
  }

  _sendError(msg, rinfo) {
    const messageId = msg[1];
    this.send('ERROR ' + messageId + ' ' + msg[0], rinfo.port, rinfo.address);
  }

  _connectClient(key, rinfo, payload) {
    const client = {
      rinfo,
      lastSeen: getTime(),
      payload,
    };

    this.clients.set(key, client);
    this.emit('connection', client, this.clients);

    if (this.verbose) {
      console.log('> connection:', client);
    }
  }

  _disconnectClient(key) {
    const client = this.clients.get(key);

    this.clients.delete(key);
    this.emit('close', client, this.clients);

    if (this.verbose) {
      console.log('> close:', client);
    }
  }

  _monitorClients() {
    const now = getTime();

    for (let [key, client] of this.clients.entries()) {
      const { lastSeen } = client;

      // times in seconds, timeout in milliseconds
      if (now - lastSeen > 0.001 * this.disconnectTimeout) {
        this._disconnectClient(key);
      }
    }
  }
}

export default DiscoveryServer;
