import dotenv from 'dotenv';
import express from 'express';
import connectDB from './config/db/config_db';
import apiRouter from './routes';
import {globalAuth} from './middleware/auth_middleware'
import morgan from 'morgan';
import cors from 'cors';
import ErrorMiddleware from './middleware/error_middleware';

dotenv.config();

const port = process.env.PORT || 4000;
const app = express();

connectDB();

app.use(cors());
app.use(express.json());
// app.use(morgan('combined'));
app.use(globalAuth);
app.use('/',apiRouter);


app.use(ErrorMiddleware.handleError)
app.listen(port, () => {
  console.log(`App listening on port ${port}`);
  console.log(`Url:   http://localhost:${port}`);
});




