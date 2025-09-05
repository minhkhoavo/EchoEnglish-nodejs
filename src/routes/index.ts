
import userRouter from './users';
import authRouter from './auth';
import testRouter from './tests'; 
import flashcardRouter from './flashcard';
import { Router } from "express";

const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/tests', testRouter); 
apiRouter.use('/flashcards', flashcardRouter);

export default apiRouter;
