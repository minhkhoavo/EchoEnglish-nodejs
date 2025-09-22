import userRouter from './users.js';
import authRouter from './auth.js';
import testRouter from './tests.js';
import flashcardRouter from './flashcard.js';
import filesRouter from './files.js';
import { Router } from 'express';
import speechRouter from './speech.js';
import payment from './payments.js';
import promo from './promo.js';
import speakingWritingRouter from './speakingWriting.js';
import speakingAttemptsRouter from './speakingAttempts.js';
import speakingRouter from './speaking.js';
import testResultsRouter from './testResults.js';
import resourceRouter from './resourceRoutes.js';


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
apiRouter.use('/test-results', testResultsRouter);
apiRouter.use('/resources', resourceRouter);

export default apiRouter;
