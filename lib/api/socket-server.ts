import { Server as SocketServer } from 'socket.io';
import { fetchLiveMatches } from './api/apiFootballClient';

let io: SocketServer;

export function initWebSocketServer(server: any) {
  io = new SocketServer(server, {
    cors: { origin: '*' }
  });

  io.on('connection', (socket) => {
    socket.on('subscribe-live', () => {
      startLiveUpdates(socket);
    });

    socket.on('disconnect', () => {});
  });
}

async function startLiveUpdates(socket: any) {
  setInterval(async () => {
    const liveData = await fetchLiveMatches();
    socket.emit('live-update', liveData);
  }, 30000);
}