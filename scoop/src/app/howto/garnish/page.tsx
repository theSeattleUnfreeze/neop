import Link from "next/link";

export default function GarnishHowToPage() {
  return (
    <div className="scoop-stack howto">
      <section className="scoop-panel">
        <p className="muted">
          <Link href="/howto">← How to</Link>
        </p>
        <h2>Garnish Core PSBTs</h2>
        <p>
          A garnish is a random OP_RETURN whose script is longer than 83 bytes and at most 120
          bytes. Knots rejects that script while the reduced-data rule holds, through 2027-09-01.
          The transaction can be broadcast on Core and will not confirm on Knots during that
          window. It is a temporary wedge for a Core wave. The lasting Core bind is still a spend
          that includes an input Knots does not have. The Knots half of a split is a Shrike
          transaction with unified sighash. Leave those files out of Garnish.
        </p>
        <p>
          Open <Link href="/garnish">Garnish</Link> when the steps below are done. Scoop adds the
          output on this machine, then you download a new PSBT and sign that file.
        </p>
      </section>

      <section className="scoop-panel">
        <h3>1. Build one unsigned Core PSBT per coin</h3>
        <ol className="howto-steps">
          <li>
            On the wallet, use Needs split for outpoints that are still unspent on both chains.
            Plan one Core transaction for each of those coins. Sign every live outpoint of the
            policy before you broadcast the first one, and pay a new policy.
          </li>
          <li>
            In Sparrow, on your Core Fulcrum, spend the whole coin to one fresh address. Save the
            unsigned PSBT. Leave the change output out, and leave the Coldcards for after Garnish.
            A signature commits to the outputs, so a file that is already signed cannot gain an
            OP_RETURN.
          </li>
          <li>
            Repeat until you have one unsigned file per coin. Scoop will not join them and will
            not pick a fee out of a second payment or a change output.
          </li>
        </ol>
      </section>

      <section className="scoop-panel">
        <h3>2. Let Core relay the garnish</h3>
        <p>
          Bitcoin Core 28’s default datacarrier limit is 83 bytes, so the node will refuse to
          relay the output until <span className="mono">datacarriersize</span> is at least 120.
          Core reads that line when it starts. There is no RPC to raise it for the broadcast and
          put it back when the send returns. Restoring the 83-byte limit takes another restart,
          and that restart drops the garnish from the mempool before miners can take it.{" "}
          <Link href="/garnish">Garnish</Link> copies <span className="mono">datacarriersize=120</span>, opens
          bitcoin.conf, and copies a restart command for this machine. It also copies{" "}
          <span className="mono">datacarriersize=83</span> for after the Core transactions are in a block. Leave Core
          running while Fulcrum is still downloading blocks.
        </p>
      </section>

      <section className="scoop-panel">
        <h3>3. Drop the files on Garnish</h3>
        <ol className="howto-steps">
          <li>
            Go to <Link href="/garnish">Garnish</Link> and choose the unsigned PSBTs. Several
            files in one drop are fine. Each file is handled on its own.
          </li>
          <li>
            Read the line under the file name. It names the shape Scoop used (raw bytes, text,
            hex, or several pushes), the data size, the OP_RETURN script length, and the fee
            before and after. The extra fee comes out of that single payment. Across one drop the
            shapes rotate, and the bytes are not a shared string.
          </li>
          <li>
            Download each garnished PSBT, or use Download all. That button saves the ten files on
            the current page, then turns the page and continues until every garnished file is
            marked. The count above the list is how many of them have been saved. The file name
            ends in <span className="mono">.garnish.psbt</span>.
          </li>
        </ol>
        <p>Scoop stops on a file when any of these are true:</p>
        <ul className="howto-steps">
          <li>It spends more than one input, or it is already signed.</li>
          <li>It already has an OP_RETURN, or it has any number of payment outputs other than one.</li>
          <li>The previous output amount is missing, or the payment would fall below dust after the extra fee.</li>
          <li>The file is empty or is not a PSBT.</li>
        </ul>
      </section>

      <section className="scoop-panel">
        <h3>4. Sign, then broadcast on Core</h3>
        <ol className="howto-steps">
          <li>Sign the garnished file on the Coldcards. Sign the Shrike transactions for the Knots half in the same wave, before any broadcast.</li>
          <li>
            Broadcast the garnished transactions with Sparrow on the Core path. Knots will reject
            the long OP_RETURN while the reduced-data rule holds. After 2027-09-01 that rejection
            ends, so a garnish alone is not how those coins stay on Core.
          </li>
          <li>
            Send the Knots transactions only after the Core spends are in a block. The split
            checklist on the wallet states the same-wave order. Scoop still does not broadcast.
          </li>
        </ol>
      </section>
    </div>
  );
}
