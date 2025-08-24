import dotenv from 'dotenv';
import express from 'express';
import connectDB from './config/db/configDB';
import apiRouter from './routes';
import morgan from 'morgan';
dotenv.config();



const port = process.env.PORT || 4000;

const app = express();


connectDB();

app.use(express.json());
app.use(morgan('combined'));

app.use('/api',apiRouter);


app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});




