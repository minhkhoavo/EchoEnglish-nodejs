import userRouter from './users';
import authRouter from './auth';
import { Router } from "express";


const apiRouter = Router();

// Router đến user
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);


export default apiRouter;