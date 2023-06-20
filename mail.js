import nodemailer from 'nodemailer';
import dotenv from 'dotenv'
dotenv.config()

// async..await is not allowed in global scope, must use a wrapper
export async function sendMail(sendInfo) {
    let transporter = nodemailer.createTransport({
        host: 'smtp.163.com',
        secure: true, // true for 465, false for other ports
        auth: {
            user: process.env.MAIL_ACCOUNT, // generated ethereal user
            pass: process.env.MAIL_PASSWORD, // generated ethereal password
        },
    });
    let info = await transporter.sendMail({
        from: process.env.MAIL_ACCOUNT, // sender address
        to: process.env.SEND_TO_MAIL, // list of receivers
        subject: sendInfo.subject, // Subject line
        text: sendInfo.content, // html body
    });
    console.log('消息发送成功: %s', info.messageId);
}