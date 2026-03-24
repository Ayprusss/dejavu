import { useRef, useState } from 'react';
import emailjs from '@emailjs/browser';
import './Contact.css';

function Contact() {
  const formRef = useRef();
  const [isSending, setIsSending] = useState(false);
  const [responseMessage, setResponseMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);

  const sendEmail = (e) => {
    e.preventDefault();
    setIsSending(true);
    setResponseMessage("");

    emailjs.sendForm('ayprusss_email_service', 'template_30qbmwr', formRef.current, 'ajgDW7hgrON568ajG')
      .then((result) => {
        console.log('Email sent successfully: ', result.text);
        setResponseMessage("Message submitted. Thanks!");
        setIsSuccess(true);
        setIsSending(false);
        formRef.current.reset();
      }, (error) => {
        console.log('Failed to send email: ', error.text);
        setResponseMessage("Error occurred. Please try again.");
        setIsSuccess(false);
        setIsSending(false);
      });
  };

  return (
    <section className="contact-page" aria-label="Contact Deja Vu">
      <form ref={formRef} className="contact-form" onSubmit={sendEmail}>
        <h1 className="contact-title">Contact</h1>

        <input
          className="contact-input"
          type="text"
          name="fullName"
          placeholder="Full Name"
          aria-label="Full Name"
          required
        />

        <input
          className="contact-input"
          type="email"
          name="email"
          placeholder="Email"
          aria-label="Email"
          required
        />

        <textarea
          className="contact-message"
          name="message"
          placeholder="Message"
          aria-label="Message"
          required
        />

        {responseMessage && (
          <p className="contact-response-message" style={{ color: isSuccess ? '#27ae60' : '#eb5757', fontSize: '13px', marginTop: '16px', textAlign: 'center' }}>
            {responseMessage}
          </p>
        )}

        <button className="contact-send" type="submit" disabled={isSending}>
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </section>
  );
}

export default Contact;
