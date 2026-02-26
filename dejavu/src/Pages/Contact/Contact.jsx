import './Contact.css';

function Contact() {
  return (
    <section className="contact-page" aria-label="Contact Deja Vu">
      <form className="contact-form" action="#" method="post">
        <h1 className="contact-title">Contact</h1>

        <input
          className="contact-input"
          type="text"
          name="fullName"
          placeholder="Full Name"
          aria-label="Full Name"
        />

        <input
          className="contact-input"
          type="email"
          name="email"
          placeholder="Email"
          aria-label="Email"
        />

        <textarea
          className="contact-message"
          name="message"
          placeholder="Message"
          aria-label="Message"
        />

        <button className="contact-send" type="submit">
          Send
        </button>
      </form>
    </section>
  );
}

export default Contact;
