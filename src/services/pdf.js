const PDFDocument = require('pdfkit');

function generateDoctorReportPDF(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 40, 
        size: 'A4'
      });
      
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const { doctor_name, doctor_id, average_rating, total_patients, date_from, date_to, question_ratings } = data;
      const rating = Number(average_rating) || 0;
      const total = Number(total_patients) || 0;
      
      const formatDate = (dateStr) => {
        if (!dateStr) return 'All Time';
        const [y, m, d] = dateStr.split('-');
        return d + '/' + m + '/' + y;
      };

      const pageW = 595;
      const leftM = 40;
      const rightM = 40;
      const contentW = pageW - leftM - rightM;

      // ========== HEADER ==========
      doc.rect(0, 0, pageW, 55).fill('#2563eb');
      
      doc.fillColor('white')
         .fontSize(20)
         .font('Helvetica-Bold')
         .text('PATIENT FEEDBACK REPORT', 0, 12, { align: 'center', width: pageW });
      
      doc.fontSize(10)
         .font('Helvetica')
         .text('Confidential - For Doctor\'s Review', 0, 35, { align: 'center', width: pageW });

      let y = 65;

      // ========== DOCTOR INFO ==========
      doc.fillColor('#111827')
         .fontSize(18)
         .font('Helvetica-Bold')
         .text(doctor_name, leftM, y);
      
      y += 22;
      
      doc.fillColor('#6b7280')
         .fontSize(9)
         .font('Helvetica')
         .text('ID: ' + doctor_id + '  |  Department: General  |  Period: ' + formatDate(date_from) + ' to ' + formatDate(date_to), leftM, y);
      
      y += 30;

      // ========== LETTER ==========
      doc.fillColor('#374151')
         .fontSize(10)
         .font('Helvetica')
         .text('Dear ' + doctor_name + ',', leftM, y);
      
      y += 16;
      
      doc.text('We present your patient feedback report for ' + formatDate(date_from) + ' to ' + formatDate(date_to) + '. This report summarizes feedback collected from ' + total + ' patient(s) who completed our patient satisfaction survey.', leftM, y, { width: contentW });
      
      y += 35;

      // ========== OVERALL RATING ==========
      doc.fillColor('#111827')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('OVERALL RATING', leftM, y);
      
      y += 18;

      // Rating box
      doc.rect(leftM, y, contentW, 50).fill('#f9fafb').stroke('#e5e7eb');

      // Big rating
      doc.fillColor('#111827')
         .fontSize(32)
         .font('Helvetica-Bold')
         .text(rating.toFixed(1), leftM + 10, y + 8);
      
      doc.fillColor('#9ca3af')
         .fontSize(14)
         .text('/ 5', leftM + 65, y + 18);

      doc.fillColor('#6b7280')
         .fontSize(9)
         .font('Helvetica')
         .text(total + ' patient(s)', leftM + 10, y + 36);

      // Status
      let statusText = 'Average';
      let statusColor = '#d97706';
      if (rating >= 4.5) { statusText = 'Excellent'; statusColor = '#059669'; }
      else if (rating >= 4.0) { statusText = 'Very Good'; statusColor = '#059669'; }
      else if (rating >= 3.5) { statusText = 'Good'; statusColor = '#2563eb'; }
      else if (rating >= 2.0) { statusText = 'Below Average'; statusColor = '#ea580c'; }
      else { statusText = 'Poor'; statusColor = '#dc2626'; }

      doc.fillColor(statusColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text(statusText, leftM + 380, y + 10);
      
      doc.fillColor('#6b7280')
         .fontSize(9)
         .font('Helvetica')
         .text(rating >= 3.5 ? 'Good performance' : 'Needs improvement', leftM + 380, y + 28);

      y += 60;

      // ========== RATING SCALE ==========
      doc.fillColor('#eff6ff')
         .rect(leftM, y, contentW, 20)
         .fill()
         .stroke('#bfdbfe');
      
      doc.fillColor('#374151')
         .fontSize(8)
         .font('Helvetica')
         .text('Rating Scale:   5 = Excellent   4 = Very Good   3 = Average   2 = Not Good   1 = Very Bad', leftM + 8, y + 5);
      
      y += 28;

      // ========== CATEGORIES ==========
      doc.fillColor('#111827')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('DETAILED RATINGS BY CATEGORY', leftM, y);
      
      y += 18;

      if (question_ratings && question_ratings.length > 0) {
        for (const qr of question_ratings) {
          const qrAvg = Number(qr.average) || 0;
          const qrCount = Number(qr.count) || 0;

          // Category row
          doc.rect(leftM, y, contentW, 40)
             .fill('#f9fafb')
             .stroke('#e5e7eb');

          // Name
          doc.fillColor('#111827')
             .fontSize(10)
             .font('Helvetica-Bold')
             .text(qr.question, leftM + 8, y + 6);
          
          // Count
          doc.fillColor('#6b7280')
             .fontSize(8)
             .font('Helvetica')
             .text(qrCount + ' patient(s)', leftM + 8, y + 22);
          
          // Rating
          doc.fillColor('#111827')
             .fontSize(16)
             .font('Helvetica-Bold')
             .text(qrAvg.toFixed(1), leftM + 400, y + 6);
          
          doc.fillColor('#9ca3af')
             .fontSize(10)
             .text('/5', leftM + 438, y + 12);
          
          // Progress bar
          const barW = 230;
          const fillW = (qrAvg / 5) * barW;
          
          doc.fillColor('#e5e7eb')
             .rect(leftM + 8, y + 32, barW, 4)
             .fill();
          
          let barColor = '#dc2626';
          if (qrAvg >= 4) barColor = '#059669';
          else if (qrAvg >= 3.5) barColor = '#2563eb';
          else if (qrAvg >= 3) barColor = '#d97706';
          
          doc.fillColor(barColor)
             .rect(leftM + 8, y + 32, fillW, 4)
             .fill();
          
          y += 45;
        }
      }

      y += 12;

      // ========== PERFORMANCE SUMMARY ==========
      doc.fillColor('#eff6ff')
         .rect(leftM, y, contentW, 75)
         .fill()
         .stroke('#bfdbfe');
      
      doc.fillColor('#111827')
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('PERFORMANCE SUMMARY', leftM + 8, y + 8);
      
      y += 22;

      let summary = '';
      if (rating >= 4.0) {
        summary = 'Outstanding performance! Patients consistently rate you at the highest levels across all aspects of care. Your dedication to patient satisfaction is evident. Continue providing this exceptional level of care.';
      } else if (rating >= 3.5) {
        summary = 'Good performance. Patients appreciate your care and service. While you are performing well, there are specific areas where focused improvement could elevate patient satisfaction even further.';
      } else if (rating >= 3.0) {
        summary = 'Average performance indicates that there is room for improvement. Consider reviewing the detailed feedback below to identify specific areas where you can enhance patient experience.';
      } else {
        summary = 'Below average ratings suggest that improvements are needed. We recommend reviewing the feedback carefully and working on areas that need attention.';
      }

      doc.fillColor('#374151')
         .fontSize(9)
         .font('Helvetica')
         .text(summary, leftM + 8, y, { width: contentW - 16, lineGap: 2 });
      
      y += 60;

      // ========== FOOTER ==========
      doc.moveTo(leftM, y).lineTo(pageW - rightM, y).stroke('#e5e7eb');
      
      y += 10;
      
      doc.fillColor('#9ca3af')
         .fontSize(8)
         .font('Helvetica')
         .text('Patient Feedback System  |  Generated: ' + new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }), 0, y, { align: 'center', width: pageW });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generateDoctorReportPDF };
