#version 450

layout(push_constant) uniform WaterPush {
//shared with vertex shader
float time;
float wave_strength;
float foam_strength;
float padding;
}uWater;

layout (location = 0) in vec2 v_uv;
 layout(location = 0) out vec4 outColor;

 float gerstner_like(vec2 uv, float t){
 //gerstner like toy for noe
 //real gerstner also displace x/z and use wave params
 //-here only synthesize a height pattern for shading
 float w0 = sin(dot(uv, normalize(vec2(1.0, 0.2))) * 32.0 + t * 1.4);
 float w1 = sin(dot(uv, normalize(vec2(-0.4, 1.0))) * 21.0 + t * 0.8);
	return 0.5 * w0 + 0.5 * w1;
 }

 void main(){
 // 1) Get animated pseudo-height at this pixel (h)
  float t = uWater.time;
  float h = gerstner_like(v_uv, t);

  //2) Turn local height slope into a fake normal (n)
  // dFdx/dFdy = "how fast value changes across neighboring pixels". (slope)
  float dx = dFdx(h);
  float dy = dFdy(h);
  vec3 n = normalize(vec3(-dx * 6.0, -dy * 6.0, 1.0));

  //3) Camera direction proxy.
  // In this prototype we assume camera faces +Z in this local frame.
  vec3 v = normalize(vec3(0.0, 0.0, 1.0));
  float fresnel = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);

  // 4) Pick colors.
	//    deep/shallow are artistic placeholders until real depth sampling.
	vec3 deep = vec3(0.03, 0.19, 0.30);
	vec3 shallow = vec3(0.08, 0.40, 0.48);
	float shallow_mix = clamp(0.5 + h * 0.5 * uWater.wave_strength, 0.0, 1.0);
	vec3 water = mix(deep, shallow, shallow_mix);

	// 5) Foam proxy on crests.
	//    smoothstep(a,b,x):
	//    - 0 below a
	//    - 1 above b
	//    - smooth blend in between
	float foam_mask = smoothstep(0.55, 0.9, h) * uWater.foam_strength;
	vec3 foam = vec3(0.92, 0.96, 1.0) * foam_mask;

	// 6) Reflection look (very cheap approximation).
	//    Real version should sample environment map.
	vec3 reflection_tint = vec3(0.45, 0.62, 0.78) * fresnel;
	vec3 color = water + reflection_tint + foam;

	// 7) Alpha blend over scene.
	outColor = vec4(color, 0.35);
 }