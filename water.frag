#version 450

 layout(location = 0) out vec4 outColor;

 void main(){
 //water.frag  
 //fixed tint for visual sanity check
 //alpha < 1 so scene remains visible
 outColor = vec4(0.05, 0.35, 0.45, 0.25);
 }