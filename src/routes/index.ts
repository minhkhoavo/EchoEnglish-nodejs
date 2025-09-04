import userRouter from './users';
import authRouter from './auth';
import testRouter from './tests'; 
import { Router } from "express";


const apiRouter = Router();

// Router đến user
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/tests', testRouter); 


export default apiRouter;
