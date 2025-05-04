import PDFDocument from 'pdfkit';
import fs from 'fs';

// Create a document
const doc = new PDFDocument();

// Pipe its output somewhere, in this case to a file
doc.pipe(fs.createWriteStream('docs/lorem-ipsum-cv.pdf'));

// Set font
doc.font('Helvetica');

// Header
doc.fontSize(24)
   .text('Curriculum Vitae', { align: 'center' })
   .moveDown();

// Personal Information
doc.fontSize(16)
   .text('Persoonlijke Gegevens')
   .moveDown(0.5);

doc.fontSize(12)
   .text('Naam: Lorem van Ipsum')
   .text('Adres: Dorpstraat 123')
   .text('Postcode: 1234 AB')
   .text('Woonplaats: Amsterdam')
   .text('Geboortedatum: 1 januari 1990')
   .text('E-mail: lorem.ipsum@email.nl')
   .text('Telefoon: +31 6 12345678')
   .moveDown();

// Work Experience
doc.fontSize(16)
   .text('Werkervaring')
   .moveDown(0.5);

doc.fontSize(12)
   .text('2018 - heden')
   .text('Senior Lorem Ipsum Specialist', { indent: 20 })
   .text('Ipsum Solutions B.V., Rotterdam', { indent: 20 })
   .text('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.', { indent: 20 })
   .moveDown();

doc.text('2015 - 2018')
   .text('Junior Lorem Developer', { indent: 20 })
   .text('Dutch Lorem Corp., Den Haag', { indent: 20 })
   .text('Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.', { indent: 20 })
   .moveDown();

// Education
doc.fontSize(16)
   .text('Opleiding')
   .moveDown(0.5);

doc.fontSize(12)
   .text('2010 - 2015')
   .text('MSc Lorem Ipsum Studies', { indent: 20 })
   .text('Universiteit van Amsterdam', { indent: 20 })
   .text('Specialisatie in dolor sit amet methodologie', { indent: 20 })
   .moveDown();

doc.text('2006 - 2010')
   .text('Bachelor Ipsum Technologie', { indent: 20 })
   .text('Hogeschool van Rotterdam', { indent: 20 })
   .moveDown();

// Skills
doc.fontSize(16)
   .text('Vaardigheden')
   .moveDown(0.5);

doc.fontSize(12)
   .text('• Lorem Ipsum Development')
   .text('• Dolor Sit Amet Management')
   .text('• Consectetur Analysis')
   .text('• Adipiscing Project Management')
   .moveDown();

// Languages
doc.fontSize(16)
   .text('Talen')
   .moveDown(0.5);

doc.fontSize(12)
   .text('Nederlands: Moedertaal')
   .text('Engels: Vloeiend')
   .text('Duits: Goed')
   .moveDown();

// Finalize PDF file
doc.end(); 