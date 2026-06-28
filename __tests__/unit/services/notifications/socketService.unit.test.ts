/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import socketService from '~/services/notifications/socketService.js';

jest.mock('socket.io', () => {
    return {
        Server: jest.fn().mockImplementation(() => {
            return {
                on: jest.fn(),
                to: jest.fn().mockReturnThis(),
                emit: jest.fn(),
            };
        }),
    };
});

describe('SocketService', () => {
    let mockHttpServer: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockHttpServer = {} as HttpServer;
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('emit methods without init (io undefined)', () => {
        it('emitToUser should return early if io is not initialized', async () => {
            (socketService as any).io = undefined;
            await socketService.emitToUser('u1', 'e1', {});
            // no error thrown
        });

        it('emitToUsers should return early if io is not initialized', async () => {
            (socketService as any).io = undefined;
            await socketService.emitToUsers(['u1'], 'e1', {});
        });

        it('emitToAll should not fail if io is not initialized', async () => {
            (socketService as any).io = undefined;
            await socketService.emitToAll('e1', {});
        });
    });

    describe('initSocket', () => {
        it('should initialize socket server and handle connection with userId', async () => {
            const io = await socketService.initSocket(mockHttpServer);
            expect(Server).toHaveBeenCalledWith(mockHttpServer, {
                cors: {
                    origin: '*',
                    methods: ['GET', 'POST'],
                },
            });
            expect(io).toBeDefined();
            expect(io.on).toHaveBeenCalledWith(
                'connection',
                expect.any(Function)
            );

            const connectionCallback = (io.on as jest.Mock).mock.calls.find(
                (call) => call[0] === 'connection'
            )[1];

            const mockSocket = {
                id: 'socket1',
                handshake: { auth: { userId: 'user1' } },
                join: jest.fn(),
                on: jest.fn(),
            };

            connectionCallback(mockSocket);
            expect(mockSocket.join).toHaveBeenCalledWith('user1');

            // Test 'join' event
            const joinCallback = mockSocket.on.mock.calls.find(
                (call: any) => call[0] === 'join'
            )[1];
            joinCallback({ userId: 'user2' });
            expect(mockSocket.join).toHaveBeenCalledWith('user2');

            // Test 'join' event without userId
            joinCallback({});

            // Test 'admin_emit_to_user'
            const adminEmitToUserCb = mockSocket.on.mock.calls.find(
                (call: any) => call[0] === 'admin_emit_to_user'
            )[1];
            adminEmitToUserCb({ userId: 'u1', event: 'e1', payload: {} });
            expect(io.to).toHaveBeenCalledWith('u1');

            // missing userId or event
            adminEmitToUserCb({ userId: '', event: 'e1', payload: {} });

            // Test 'admin_emit_to_users'
            const adminEmitToUsersCb = mockSocket.on.mock.calls.find(
                (call: any) => call[0] === 'admin_emit_to_users'
            )[1];
            adminEmitToUsersCb({
                userIds: ['u1', 'u2'],
                event: 'e1',
                payload: {},
            });
            expect(io.to).toHaveBeenCalledWith('u1');
            expect(io.to).toHaveBeenCalledWith('u2');

            // missing userIds
            adminEmitToUsersCb({ event: 'e1', payload: {} });

            // Test 'admin_emit_to_all'
            const adminEmitToAllCb = mockSocket.on.mock.calls.find(
                (call: any) => call[0] === 'admin_emit_to_all'
            )[1];
            adminEmitToAllCb({ event: 'e1', payload: {} });
            expect(io.emit).toHaveBeenCalledWith('e1', {});

            // missing event
            adminEmitToAllCb({ event: '', payload: {} });

            // Test 'disconnect'
            const disconnectCb = mockSocket.on.mock.calls.find(
                (call: any) => call[0] === 'disconnect'
            )[1];
            disconnectCb();
        });

        it('should handle connection without userId', async () => {
            const io = await socketService.initSocket(mockHttpServer);
            const connectionCallback = (io.on as jest.Mock).mock.calls.find(
                (call) => call[0] === 'connection'
            )[1];

            const mockSocketNoUser = {
                id: 'socket2',
                handshake: { auth: {} },
                join: jest.fn(),
                on: jest.fn(),
            };
            connectionCallback(mockSocketNoUser);
            expect(mockSocketNoUser.join).not.toHaveBeenCalled();
            expect(console.log).toHaveBeenCalledWith(
                'User connected without userId: socket2'
            );
        });
    });

    describe('emit methods', () => {
        let io: any;

        beforeEach(async () => {
            io = await socketService.initSocket(mockHttpServer);
        });

        it('emitToUser should call io.to().emit()', async () => {
            await socketService.emitToUser('u1', 'e1', { a: 1 });
            expect(io.to).toHaveBeenCalledWith('u1');
            expect(io.to().emit).toHaveBeenCalledWith('e1', { a: 1 });
        });

        it('emitToUsers should call io.to().emit() for each user', async () => {
            await socketService.emitToUsers(['u1', 'u2'], 'e1', { a: 1 });
            expect(io.to).toHaveBeenCalledWith('u1');
            expect(io.to).toHaveBeenCalledWith('u2');
        });

        it('emitToAll should call io.emit()', async () => {
            await socketService.emitToAll('e1', { a: 1 });
            expect(io.emit).toHaveBeenCalledWith('e1', { a: 1 });
        });
    });
});
