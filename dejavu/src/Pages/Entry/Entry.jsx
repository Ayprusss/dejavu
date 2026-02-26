import './Entry.css';
import introPhoto from './dejavu-intro-photo.webp';

function Entry() {
  return (
    <section className="entry-page" aria-label="Deja Vu entry">
      <div className="entry-image-wrap">
        <img
          className="entry-image"
          src={introPhoto}
          alt="Deja Vu SS26 model in lookbook styling"
        />
      </div>

      <a className="entry-collection-link" href="#">
        SS26 2nd Delivery
      </a>
    </section>
  );
}

export default Entry;
