// Stub for the 'sharp' image-processing library.
// @huggingface/transformers requires it at the top level but only uses it
// for image tasks — never for ASR. This stub lets the module load cleanly.
function sharp() {
  throw new Error('[sharp-stub] image processing is not available');
}
sharp.default = sharp;
module.exports = sharp;
