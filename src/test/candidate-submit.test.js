import { expect } from 'chai';
import sinon from 'sinon';
import { processJobApplication } from '../services/candidatesSync.js';
import mysolutionAPI from '../api/mysolution.js';
import { transformWebflowToMysolution } from '../models/candidatesTransformer.js';

describe('Candidate Submission Tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('processJobApplication', () => {
    it('should process a job application with minimum required fields', async () => {
      // Mock the API call to avoid actual API requests
      const createApplicationStub = sinon.stub(mysolutionAPI, 'createApplication').resolves({
        id: 'test-application-id',
        status: 'success'
      });

      // Sample form data with minimum fields
      const formData = {
        'first-name': 'John',
        'last-name': 'Doe',
        'email': 'john.doe@example.com',
        'phone': '1234567890',
        'message': 'I am interested in this position'
      };

      // Call the processJobApplication function
      const result = await processJobApplication('test-job-id', formData);

      // Verify the result
      expect(result.success).to.be.true;
      expect(result.message).to.equal('Application submitted successfully');
      
      // Verify that createApplication was called with the correct parameters
      expect(createApplicationStub.calledOnce).to.be.true;
      
      // Get the arguments passed to createApplication
      const callArgs = createApplicationStub.getCall(0).args;
      
      // Verify fields were passed correctly
      expect(callArgs[0]).to.have.property('Email');
      expect(callArgs[0].Email.value).to.equal('john.doe@example.com');
      expect(callArgs[0]).to.have.property('First Name');
      expect(callArgs[0]['First Name'].value).to.equal('John');
      expect(callArgs[0]).to.have.property('Last Name');
      expect(callArgs[0]['Last Name'].value).to.equal('Doe');
    });

    it('should handle file uploads correctly', async () => {
      // Mock the API call to avoid actual API requests
      const createApplicationStub = sinon.stub(mysolutionAPI, 'createApplication').resolves({
        id: 'test-application-id',
        status: 'success'
      });

      // Create a mock file upload
      const mockFile = {
        originalname: 'resume.pdf',
        buffer: Buffer.from('test file content'),
        mimetype: 'application/pdf',
        size: 100
      };

      // Sample form data with a file
      const formData = {
        'first-name': 'Jane',
        'last-name': 'Smith',
        'email': 'jane.smith@example.com',
        'phone': '0987654321',
        'message': 'I am the perfect candidate',
        'cv': mockFile
      };

      // Call the processJobApplication function
      const result = await processJobApplication('test-job-id', formData);

      // Verify the result
      expect(result.success).to.be.true;
      
      // Get the arguments passed to createApplication
      const callArgs = createApplicationStub.getCall(0).args;
      
      // Verify file was included
      expect(callArgs[0]).to.have.property('CV');
      expect(callArgs[0].CV.fileName).to.equal('resume.pdf');
      expect(callArgs[0].CV.value).to.be.a('string'); // base64 encoded
    });

    it('should handle API errors gracefully', async () => {
      // Mock the API call to throw an error
      sinon.stub(mysolutionAPI, 'createApplication').rejects(new Error('API error'));

      // Sample form data
      const formData = {
        'first-name': 'John',
        'last-name': 'Doe',
        'email': 'john.doe@example.com'
      };

      // Call the processJobApplication function
      const result = await processJobApplication('test-job-id', formData);

      // Verify the result
      expect(result.success).to.be.false;
      expect(result.error).to.equal('API error');
    });
  });

  describe('transformWebflowToMysolution', () => {
    it('should transform Webflow form data to Mysolution format', () => {
      // Sample form data
      const formData = {
        'first-name': 'John',
        'last-name': 'Doe',
        'email': 'john.doe@example.com',
        'phone': '1234567890',
        'message': 'I am interested in this position'
      };

      // Transform the data
      const result = transformWebflowToMysolution(formData, 'test-job-id');

      // Verify the transformation - updated to match new field structure
      expect(result).to.be.an('object');
      
      // Check that fields were mapped correctly with new field names
      expect(result).to.have.property('Email');
      expect(result.Email.value).to.equal('john.doe@example.com');
      expect(result).to.have.property('First Name');
      expect(result['First Name'].value).to.equal('John');
      expect(result).to.have.property('Last Name');
      expect(result['Last Name'].value).to.equal('Doe');
      
      // Check that Motivation field was mapped
      expect(result).to.have.property('Motivation');
      expect(result.Motivation.value).to.equal('I am interested in this position');
    });

    it('should handle missing data gracefully', () => {
      // Sample form data with missing fields
      const formData = {
        'email': 'john.doe@example.com'
      };

      // Transform the data
      const result = transformWebflowToMysolution(formData);

      // Verify default values are set for missing fields
      expect(result).to.have.property('Email');
      expect(result.Email.value).to.equal('john.doe@example.com');
      // Fields not provided shouldn't be in the result
      expect(result).to.not.have.property('First Name');
      expect(result).to.not.have.property('Last Name');
    });
  });
}); 