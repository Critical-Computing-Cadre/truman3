import { useParams } from "@tanstack/react-router";
import { PERSONAS_FILE } from "@truman3/core";
import { YamlPage } from "../components/YamlPage.tsx";

/** What a study with no personas starts from. */
const EXAMPLE = `# Personas: who simulated participants are, for a model to play while you pilot the study.
# Run them from the Simulate page beside a saved version.
# See https://truman-research.org/guide/testing
model: claude-sonnet-5-5
personas:
  - id: shy-first-year
    about: >
      A first-year student who's new here and a little shy. Reads everything, likes things
      now and then, and rarely comments unless something feels unfair.
  - id: outspoken
    about: >
      Confident and quick to give an opinion. Comments often, and pushes back when someone
      is being mean.
`;

function Reference() {
  const row = "border-t border-stone-200 py-1 align-top";
  return (
    <details className="card p-3 text-sm" open>
      <summary className="cursor-pointer font-medium">How personas work</summary>
      <table className="mt-2 w-full text-left text-xs">
        <tbody>
          <tr>
            <th className={`${row} w-24 font-mono`}>model</th>
            <td className={row}>
              The Claude model that plays them. A cheaper one keeps piloting cheap
            </td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>id</th>
            <td className={row}>A short name, with lowercase letters, numbers, and dashes</td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>about</th>
            <td className={row}>
              Who they are, how they use social media, and what they care about, in plain words
            </td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>condition</th>
            <td className={row}>
              The condition they start in. Leave it out to spread them across the conditions
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  );
}

/**
 * The study's personas for simulated participants, written in YAML. A model plays them from the
 * Simulate page. See ADR 60.
 */
export function PersonasPage() {
  const { draftId } = useParams({ from: "/drafts/$draftId/personas" });
  return (
    <YamlPage
      draftId={draftId}
      file={PERSONAS_FILE}
      heading="Personas in"
      intro={
        <>
          A persona is someone a model plays as a simulated participant, to pilot the study before
          real people take part. Save a version, then press <strong>Simulate</strong> beside it on
          the Studies page to choose personas and read what each one saw and did.
        </>
      }
      empty="This study has no personas yet. Here are two to start from. Nothing runs until you choose them on the Simulate page."
      example={EXAMPLE}
      label="Personas"
      saveLabel="Save personas"
      reference={<Reference />}
    />
  );
}
