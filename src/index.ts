import dotenv from 'dotenv';
import express from 'express';
import connectDB from './config/configDB';

dotenv.config();

const port = process.env.PORT || 4000;

const app = express();

connectDB();


app.use(express.json);



app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});




