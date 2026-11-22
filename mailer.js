import nodemailer from 'nodemailer';
export const mailReady = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_FROM && process.env.APP_BASE_URL);
export async function sendMail(to,subject,text) {
  if(!mailReady()) throw new Error('SMTP is not configured');
  const transport = nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT),
    secure:Number(process.env.SMTP_PORT)===465,connectionTimeout:8000,socketTimeout:10000,
    ...(process.env.SMTP_USER?{auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}}:{})});
  try {await transport.sendMail({from:process.env.SMTP_FROM,to,subject,text});}finally{transport.close();}
}
