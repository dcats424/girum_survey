const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  } else {
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: 'ethereal.test@email.com',
        pass: 'test123'
      }
    });
  }
  
  return transporter;
}

async function sendEmail({ to, subject, html, pdfBuffer, pdfFilename }) {
  try {
    const transport = getTransporter();
    
    const mailOptions = {
      from: process.env.SMTP_FROM || '"Patient Feedback System" <noreply@hospital.com>',
      to,
      subject,
      html
    };
    
    if (pdfBuffer) {
      mailOptions.attachments = [
        {
          filename: pdfFilename || 'patient-feedback-report.pdf',
          content: pdfBuffer
        }
      ];
    }
    
    const info = await transport.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    console.error('Email failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendEmail };
