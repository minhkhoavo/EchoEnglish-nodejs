import userRouter from './users';
import authRouter from './auth';
import testRouter from './tests';
import flashcardRouter from './flashcard';
import filesRouter from './files';
import { Router } from 'express';
import speechRouter from './speech';
import speakingWritingRouter from './speakingWriting';

const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/tests', testRouter);
apiRouter.use('/flashcards', flashcardRouter);
apiRouter.use('/files', filesRouter);
apiRouter.use('/speech', speechRouter);
apiRouter.use('/sw-tests', speakingWritingRouter);

export default apiRouter;
