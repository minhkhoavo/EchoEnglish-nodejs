import dotenv from 'dotenv';
import express from 'express';
import connectDB from './config/db/configDB';
import apiRouter from './routes';
import {globalAuth} from './middleware/auth.middleware'
import morgan from 'morgan';
import cors from 'cors';

dotenv.config();

const port = process.env.PORT || 4000;
const app = express();

connectDB();

app.use(cors());
app.use(express.json());
app.use(morgan('combined'));
app.use(globalAuth);
app.use('/',apiRouter);

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});




