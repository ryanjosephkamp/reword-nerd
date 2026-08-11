# Design Principles — reword-nerd

## 1. Semantic Fidelity First
The primary goal is accurate preservation of meaning. Structural change is valuable only when meaning remains intact.

## 2. Explicit Decomposition
The package makes the decomposition stage explicit and gives the user a clear
place to inspect its result before it is carried into later stages.

## 3. Genuine Structural Difference
The rewrite should not be a shallow synonym substitution. Sentence structure, paragraph organization, and phrasing should change meaningfully.

## 4. Inspectability
Users should be able to examine the reviewed source extraction and the
decomposition and verification artifacts they create while following the
package. Hidden multi-step behavior is avoided.

## 5. Model-Agnostic
The core value lives in the prompt pipeline and process design. The browser
workbench creates a manual package for a user to run with a model they choose;
it does not execute that model itself.

## 6. Neutral Professional Framing
This project is a high-quality rewriting and paraphrasing tool for academic, professional, and technical writing. All documentation and prompts must reflect that framing exclusively.
