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
                console.log(`User ${userId} joined room successfully`);
                console.log(
                    `Rooms for socket ${socket.id}:`,
                    Array.from(socket.rooms)
                );
            } else {
                console.log(`User connected without userId: ${socket.id}`);
            }

            // Listen for join event from client
            socket.on('join', (data) => {
                if (data.userId) {
                    socket.join(`${data.userId}`);
                    console.log(
                        `User ${data.userId} manually joined room via join event`
                    );
                }
            });

            socket.on('disconnect', () => {
                console.log(
                    `User ${userId || 'unknown'} disconnected:`,
                    socket.id
                );
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
        console.log(`Emitting ${event} to user ${userId}:`, payload);
        this.io.to(userId).emit(event, payload);
    };

    /** Emit tới user */
    public emitToUsers = async <T>(
        userIds: string[],
        event: string,
        payload: T
    ) => {
        if (!this.io) return;
        console.log(
            `Emitting ${event} to users ${userIds.join(', ')}:`,
            payload
        );
        for (const u of userIds) {
            this.io.to(u).emit(event, payload);
        }
    };

    /** Emit tới tất cả client */
    public emitToAll = async <T>(event: string, payload: T) => {
        console.log(`Broadcasting ${event} to all clients:`, payload);
        this.io?.emit(event, payload);
    };
    /*
    Có 4 event hiện tại là 
        notifications
        notifications_read
        notifications_read_all
        notifications_deleted
    */
}

export default new SocketService();
