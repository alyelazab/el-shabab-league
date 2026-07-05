import { SCORING } from '../lib/scoring/config';

export function Rules() {
  return (
    <div className="screen">
      <p className="eyebrow first">How it works</p>

      <div className="card rule">
        <h3>⚽ Predict three things</h3>
        <p>
          For each knockout match, call the <b>final score</b>, <b>who scores</b> the goals, and the{' '}
          <b>15-minute window</b> each goal lands in. Predict early, tweak anytime — everything locks{' '}
          <b>5 minutes before kickoff</b>.
        </p>
      </div>

      <div className="card rule">
        <h3>🎯 How points work</h3>
        <p>The bigger the call, the bigger the points — score matters most, then scorers and timing.</p>
        <table className="score-table">
          <tbody>
            <tr><td>Exact scoreline</td><td className="pts">{SCORING.exactScore}</td></tr>
            <tr><td>Right result, wrong score</td><td className="pts">{SCORING.correctResult}</td></tr>
            <tr><td>Each correct goalscorer</td><td className="pts">{SCORING.perScorer}</td></tr>
            <tr><td>Each correct goal timing</td><td className="pts">+{SCORING.perTiming}</td></tr>
          </tbody>
        </table>
        <p style={{ marginTop: 10 }}>
          Same player can score twice — pick them in two slots for a brace. Scoring uses regulation time
          (90 mins + stoppage); extra time and penalties don't count.
        </p>
      </div>

      <div className="card rule">
        <h3>⏱️ How's it settled? <span className="tag">+{SCORING.decidedBonus}</span></h3>
        <p>
          Call how the tie ends for a bonus. Predict a <b>winner</b> → say <b>Full Time</b> or
          <b> Extra Time</b>. Predict a <b>draw</b> → it goes to a shootout, so pick <b>who goes
          through</b> on penalties. Nail it for <b>+{SCORING.decidedBonus}</b>.
        </p>
      </div>

      <div className="card rule">
        <h3>🃏 Double or Nothing</h3>
        <p>
          You get <span className="tag">one</span> card for the whole tournament. Play it on any match before
          it locks:
        </p>
        <p style={{ marginTop: 6 }}>
          • Get <b>all three</b> right (score, scorers, timing) → <b>double</b> your points for that match.<br />
          • Get <b>one or two</b> right → normal points, no harm done.<br />
          • Get <b>all three</b> wrong → <b>−5 points</b>. Choose your moment.
        </p>
      </div>

      <div className="card rule">
        <h3>🏆 Win the league</h3>
        <p>
          Points stack across every round — Round of 16 to the Final. Highest total when the trophy's lifted
          takes it. May the best of the shabab win.
        </p>
      </div>
    </div>
  );
}
