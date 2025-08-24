import userRouter from './users';
import { Router } from "express";


const apiRouter = Router();
apiRouter.use('/users', userRouter);


export default apiRouter;