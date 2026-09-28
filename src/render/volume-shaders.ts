const uniformBlock = `uniform volumeUniforms {
 vec2 regionOffset;
 vec4 spatialCoverage;
 vec3 slices;
 vec3 size;
 vec3 counts;
 float filterActive;
 float timeIndex;
 vec2 valueRange;
 float paletteIndex;
} volume;`;

export const volumeModule = {
  name: 'volume',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    regionOffset: 'vec2<f32>',
    spatialCoverage: 'vec4<f32>',
    slices: 'vec3<f32>',
    size: 'vec3<f32>',
    counts: 'vec3<f32>',
    filterActive: 'f32',
    timeIndex: 'f32',
    valueRange: 'vec2<f32>',
    paletteIndex: 'f32',
  },
} as const;

export const vs = `#version 300 es
in vec3 positions;
in vec2 instanceCellFace;
uniform sampler2D coordinatesTexture;
out vec3 vCoord;
flat out int cellId;
float boundary(int i,int axis,int count,bool upper){
 if(!upper && i==0)return 0.;
 if(upper && i==count-1)return 1.;
 int other=i+(upper?1:-1);
 return .5*(texelFetch(coordinatesTexture,ivec2(i,axis),0).r+texelFetch(coordinatesTexture,ivec2(other,axis),0).r);
}
void main(){
 float sourceFace=instanceCellFace.y;
 float axis=volume.filterActive>.5?(sourceFace>5.5?0.:sourceFace):positions.z; vec3 q;


 if(axis<0.5)q=vec3(positions.xy,1.0);
 else if(axis<1.5)q=vec3(positions.x,0.0,positions.y);
 else if(axis<2.5)q=vec3(1.0,positions.xy);
 else if(axis<3.5)q=vec3(positions.xy,0.0);
 else if(axis<4.5)q=vec3(positions.x,1.0,positions.y);
 else q=vec3(0.0,positions.xy);
 cellId=int(instanceCellFace.x);
 if(volume.filterActive>.5){
   int nx=int(volume.counts.x),ny=int(volume.counts.y);
   int cut=int(volume.timeIndex);
   if(sourceFace>5.5)cellId+=cut*nx*ny;
   ivec3 index=ivec3(cellId%nx,(cellId/nx)%ny,cellId/(nx*ny));


   if(index.z>cut || (sourceFace<.5 && index.z==cut)) {
     vCoord=vec3(0.); gl_Position=vec4(2.,2.,2.,1.); return;
   }
   vec3 lo,hi;
   for(int a=0;a<3;a++){lo[a]=boundary(index[a],a,int(volume.counts[a]),false);hi[a]=boundary(index[a],a,int(volume.counts[a]),true);}
   lo.y=max(lo.y,volume.slices.y); hi.x=min(hi.x,volume.slices.x); hi.z=min(hi.z,volume.slices.z);
   q=mix(lo,hi,q);
 }else {


   vec2 lo=max(vec2(0.,volume.slices.y),-volume.regionOffset);
   vec2 hi=min(vec2(volume.slices.x,1.),vec2(1.)-volume.regionOffset);
   vec2 coverageLo=vec2(
     boundary(int(volume.spatialCoverage.x),0,int(volume.counts.x),false),
     boundary(int(volume.spatialCoverage.y),1,int(volume.counts.y),false));
   vec2 coverageHi=vec2(
     boundary(int(volume.spatialCoverage.z),0,int(volume.counts.x),true),
     boundary(int(volume.spatialCoverage.w),1,int(volume.counts.y),true));
   lo=max(lo,coverageLo-volume.regionOffset);
   hi=min(hi,coverageHi-volume.regionOffset);
   if(any(lessThan(hi,lo))){
     vCoord=vec3(0.); gl_Position=vec4(2.,2.,2.,1.); return;
   }
   q=vec3(mix(lo,hi,q.xy),q.z*volume.slices.z);
 }
 vCoord=q;
 if(volume.filterActive>.5) q.xy-=volume.regionOffset;
 else vCoord.xy+=volume.regionOffset;
 vec3 pos=(q-0.5)*volume.size;
 geometry.worldPosition=pos; geometry.pickingColor=vec3(1.,0.,0.);
 gl_Position=project_position_to_clipspace(pos,vec3(0.),vec3(0.),geometry.position);
 DECKGL_FILTER_GL_POSITION(gl_Position,geometry);
 vec4 c=vec4(1.);DECKGL_FILTER_COLOR(c,geometry);
}`;

export const fs = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D volumeTexture;
uniform sampler2D paletteTexture;
uniform sampler3D selectionTexture;
uniform sampler2D coordinatesTexture;
in vec3 vCoord;
flat in int cellId;
out vec4 fragColor;
int findIndex(float q,int axis,int count){int low=0;int high=count-1;for(int i=0;i<13;i++){if(low>=high)break;int mid=(low+high)/2;float a=texelFetch(coordinatesTexture,ivec2(mid,axis),0).r;float b=texelFetch(coordinatesTexture,ivec2(min(mid+1,count-1),axis),0).r;if(q>(a+b)*.5)low=mid+1;else high=mid;}return low;}
void main(){
 vec2 overlapLo=max(vec2(0.,volume.slices.y),-volume.regionOffset);
 vec2 overlapHi=min(vec2(volume.slices.x,1.),vec2(1.)-volume.regionOffset);
 if(any(lessThan(overlapHi,overlapLo)))discard;
 vec2 displayCoord=vCoord.xy-volume.regionOffset;
 if(any(lessThan(vCoord.xy,vec2(-0.00001))) || any(greaterThan(vCoord.xy,vec2(1.00001))))discard;
 if(displayCoord.x<-.00001 || displayCoord.x>volume.slices.x+.00001 || displayCoord.y<volume.slices.y-.00001 || displayCoord.y>1.00001)discard;
 ivec3 index=ivec3(findIndex(vCoord.x,0,int(volume.counts.x)),findIndex(vCoord.y,1,int(volume.counts.y)),findIndex(vCoord.z,2,int(volume.counts.z)));
 if(volume.filterActive>.5) index=ivec3(cellId%int(volume.counts.x),(cellId/int(volume.counts.x))%int(volume.counts.y),cellId/(int(volume.counts.x)*int(volume.counts.y)));
 else index.xy=clamp(index.xy,ivec2(volume.spatialCoverage.xy),ivec2(volume.spatialCoverage.zw));


 if(index.x<int(volume.spatialCoverage.x) || index.y<int(volume.spatialCoverage.y) || index.x>int(volume.spatialCoverage.z) || index.y>int(volume.spatialCoverage.w)) discard;
 if(volume.filterActive>.5 && texelFetch(selectionTexture,index,0).r<.5) discard;
 float value=texelFetch(volumeTexture,index,0).r;
 bool missing=isnan(value)||isinf(value);
 float span=volume.valueRange.y-volume.valueRange.x;
 float scaled=clamp((value-volume.valueRange.x)/(span==0.?1.:span),0.,1.);
 fragColor=texture(paletteTexture,vec2(scaled,(volume.paletteIndex+.5)/float(textureSize(paletteTexture,0).y)));
 DECKGL_FILTER_COLOR(fragColor,geometry);
 if(picking.isActive<.5) {
   fragColor.a=1.0;
 }

 if(picking.isActive>.5 && picking.isAttribute<.5){int n=(index.z*int(volume.counts.y)+index.y)*int(volume.counts.x)+index.x+1;fragColor.rgb=vec3(n%256,(n/256)%256,(n/65536)%256)/255.;}
 else if(picking.isActive<.5 && missing){fragColor=vec4(0.,0.,0.,1.);}
}`;
