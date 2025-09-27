import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

class SocketService {
    private io?: Server;
    public initSocket = async (httpServer: HttpServer) => {
        this.io = new Server(httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
        });

        this.io.on('connection', (socket: Socket) => {
            console.log('User connected:', socket.id);
            const userId = socket.handshake.auth?.userId;
            if (userId) {
                socket.join(`${userId}`); // mỗi userId là 1 room
                console.log(`User ${userId} joined`);
            } else {
                console.log(`User connected without userId: ${socket.id}`);
            }

            socket.on('disconnect', () => {
                console.log('User disconnected:', socket.id);
            });
        });

        return this.io;
    };

    /** Emit tới 1 user (room) */
    public emitToUser = async <T>(
        userId: string,
        event: string,
        payload: T
    ) => {
        if (!this.io) return;
        this.io.to(userId).emit(event, payload);
    };

    /** Emit tới user */
    public emitToUsers = async <T>(
        userIds: string[],
        event: string,
        payload: T
    ) => {
        if (!this.io) return;
        for (const u of userIds) {
            this.io.to(u).emit(event, payload);
        }
    };

    /** Emit tới tất cả client */
    public emitToAll = async <T>(event: string, payload: T) => {
        this.io?.emit(event, payload);
    };
}

export default new SocketService();
