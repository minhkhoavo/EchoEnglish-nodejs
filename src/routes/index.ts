import userRouter from './users';
import authRouter from './auth';
import testRouter from './tests';
import flashcardRouter from './flashcard';
import filesRouter from './files';
import { Router } from 'express';
import speechRouter from './speech';
import payment from './payments';
import promo from './promo';
import speakingWritingRouter from './speakingWriting';
import speakingAttemptsRouter from './speakingAttempts';
import speakingRouter from './speaking';
import youtubeTranscriptRouter from './youtubeTranscript';

const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/tests', testRouter);
apiRouter.use('/flashcards', flashcardRouter);
apiRouter.use('/files', filesRouter);
apiRouter.use('/speech', speechRouter);
apiRouter.use('/payments', payment);
apiRouter.use('/promo', promo);
apiRouter.use('/sw-tests', speakingWritingRouter);
apiRouter.use('/speaking-attempts', speakingAttemptsRouter);
apiRouter.use('/api/v1/speaking-attempts', speakingAttemptsRouter);
apiRouter.use('/speaking', speakingRouter);
apiRouter.use('/youtube-transcript', youtubeTranscriptRouter);

export default apiRouter;
